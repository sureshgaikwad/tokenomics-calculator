import {
  type ModelQualityBundle,
  managedCatalogKey,
  openWeightCatalogKey,
} from "@tokenomics/pricing-data";
import { resolveHyperscaler } from "./hyperscaler-resolve.js";
import type { JudgeWarning, ScenarioInput } from "./types.js";

export interface ModelQualityComparison {
  managed?: {
    modelId: string;
    equivalenceClass: string;
    equivalenceLabel: string;
    average?: number;
    mmluPro?: number;
    scoreSource?: string;
  };
  selfHosted?: {
    modelId: string;
    equivalenceClass: string;
    equivalenceLabel: string;
    average?: number;
    mmluPro?: number;
    scoreSource?: string;
  };
  sameEquivalenceClass: boolean;
  averageGap?: number;
  suggestedOpenModels?: string[];
}

const TIER_ORDER = [
  "frontier",
  "strong-open-70b",
  "coder-specialist",
  "mid-open",
  "fast-api",
] as const;

function tierRank(classId: string): number {
  const i = TIER_ORDER.indexOf(classId as (typeof TIER_ORDER)[number]);
  return i >= 0 ? i : TIER_ORDER.length;
}

export function compareModelQuality(
  scenario: ScenarioInput,
  quality: ModelQualityBundle
): ModelQualityComparison | undefined {
  const h = resolveHyperscaler(scenario);
  if (!h) return undefined;

  const managedKey =
    h.mode === "managedApi" && h.managedModelId
      ? managedCatalogKey(h.cloud, h.managedModelId)
      : undefined;
  const openId =
    scenario.openshift?.selfHostedModelId ?? h.selfHostedModelId ?? scenario.aws?.selfHostedModelId;
  const openKey = openId ? openWeightCatalogKey(openId) : undefined;

  const managedEntry = managedKey ? quality.byCatalogKey[managedKey] : undefined;
  const openEntry = openKey ? quality.byCatalogKey[openKey] : undefined;
  if (!managedEntry && !openEntry) return undefined;

  const result: ModelQualityComparison = {
    sameEquivalenceClass:
      Boolean(managedEntry && openEntry) &&
      managedEntry!.equivalenceClass === openEntry!.equivalenceClass,
  };

  if (managedEntry && h.managedModelId) {
    result.managed = {
      modelId: h.managedModelId,
      equivalenceClass: managedEntry.equivalenceClass,
      equivalenceLabel: managedEntry.equivalenceLabel,
      average: managedEntry.scores.average,
      mmluPro: managedEntry.scores.mmluPro,
      scoreSource: managedEntry.scoreSource,
    };
  }

  if (openEntry && openId) {
    result.selfHosted = {
      modelId: openId,
      equivalenceClass: openEntry.equivalenceClass,
      equivalenceLabel: openEntry.equivalenceLabel,
      average: openEntry.scores.average,
      mmluPro: openEntry.scores.mmluPro,
      scoreSource: openEntry.scoreSource,
    };
  }

  if (
    result.managed?.average !== undefined &&
    result.selfHosted?.average !== undefined
  ) {
    result.averageGap = result.managed.average - result.selfHosted.average;
  }

  if (managedEntry && openEntry && managedEntry.equivalenceClass !== openEntry.equivalenceClass) {
    const target = managedEntry.equivalenceClass;
    result.suggestedOpenModels = quality.entries
      .filter(
        (e) =>
          e.catalogKey.startsWith("open:") &&
          e.equivalenceClass === target &&
          e.scores.average !== undefined
      )
      .sort((a, b) => (b.scores.average ?? 0) - (a.scores.average ?? 0))
      .slice(0, 3)
      .map((e) => e.catalogKey.replace(/^open:/, ""));
  }

  return result;
}

export function modelEquivalenceJudges(
  scenario: ScenarioInput,
  quality: ModelQualityBundle
): JudgeWarning[] {
  const cmp = compareModelQuality(scenario, quality);
  if (!cmp?.managed || !cmp.selfHosted) return [];

  const warnings: JudgeWarning[] = [];
  const managedRank = tierRank(cmp.managed.equivalenceClass);
  const openRank = tierRank(cmp.selfHosted.equivalenceClass);

  if (!cmp.sameEquivalenceClass) {
    const gap =
      cmp.averageGap !== undefined
        ? ` OLL average gap ~${cmp.averageGap >= 0 ? "+" : ""}${cmp.averageGap.toFixed(1)} pts.`
        : "";
    warnings.push({
      id: "model-quality-tier-mismatch",
      severity: openRank > managedRank ? "warning" : "info",
      message:
        `Managed API (${cmp.managed.equivalenceLabel}) vs open-weight (${cmp.selfHosted.equivalenceLabel}) may not be an apples-to-apples quality comparison.${gap}`,
      suggestion:
        cmp.suggestedOpenModels?.length
          ? `For a closer tier match to the API model, try open-weight: ${cmp.suggestedOpenModels.join(", ")}.`
          : "Pick models in the same equivalence tier in model-quality.yaml or align managed vs open selections manually.",
    });
  } else if (cmp.averageGap !== undefined && Math.abs(cmp.averageGap) > 8) {
    warnings.push({
      id: "model-quality-score-gap",
      severity: "info",
      message: `Same quality tier, but Hugging Face OLL average differs by ~${Math.abs(cmp.averageGap).toFixed(1)} points between selections.`,
      suggestion: "Review OLL scores in the model panel; pricing crossover assumes comparable capability.",
    });
  }

  return warnings;
}
