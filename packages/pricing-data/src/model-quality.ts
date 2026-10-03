import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  fetchOpenLlmLeaderboardIndex,
  lookupLeaderboardScores,
  type HuggingFaceLeaderboardScores,
} from "./live/huggingface-leaderboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(__dirname, "..", "data");

export interface EquivalenceClass {
  id: string;
  label: string;
  description: string;
  averageMin: number;
  averageMax: number;
}

export interface ModelQualityScores {
  average?: number;
  mmluPro?: number;
  gpqa?: number;
  ifeval?: number;
  mathLvl5?: number;
}

export interface ModelQualityEntryYaml {
  catalogKey: string;
  equivalenceClass: string;
  huggingFaceRepo?: string;
  staticScores?: ModelQualityScores;
}

export interface ModelQualityCatalogYaml {
  version: string;
  source: string;
  description?: string;
  equivalenceClasses: EquivalenceClass[];
  entries: ModelQualityEntryYaml[];
}

export interface ResolvedModelQualityEntry {
  catalogKey: string;
  equivalenceClass: string;
  equivalenceLabel: string;
  huggingFaceRepo?: string;
  scores: ModelQualityScores;
  scoreSource: "huggingface-oll" | "static" | "static+fallback";
}

export interface ModelQualityBundle {
  version: string;
  source: string;
  equivalenceClasses: EquivalenceClass[];
  entries: ResolvedModelQualityEntry[];
  byCatalogKey: Record<string, ResolvedModelQualityEntry>;
  provenance: {
    fetchedAt: string;
    huggingFaceLeaderboard: boolean;
    leaderboardReposMatched: number;
    notes: string[];
  };
}

function loadYamlCatalog(): ModelQualityCatalogYaml {
  const raw = readFileSync(join(dataRoot, "model-quality.yaml"), "utf8");
  return parse(raw) as ModelQualityCatalogYaml;
}

function mergeScores(
  staticScores: ModelQualityScores | undefined,
  hf: HuggingFaceLeaderboardScores | undefined
): { scores: ModelQualityScores; source: ResolvedModelQualityEntry["scoreSource"] } {
  if (hf?.average !== undefined) {
    return {
      scores: {
        average: hf.average,
        mmluPro: hf.mmluPro ?? staticScores?.mmluPro,
        gpqa: hf.gpqa ?? staticScores?.gpqa,
        ifeval: hf.ifeval ?? staticScores?.ifeval,
        mathLvl5: hf.mathLvl5 ?? staticScores?.mathLvl5,
      },
      source: staticScores?.average !== undefined ? "static+fallback" : "huggingface-oll",
    };
  }
  if (staticScores) {
    return { scores: staticScores, source: "static" };
  }
  return { scores: {}, source: "static" };
}

export function loadModelQualityCatalog(): ModelQualityBundle {
  return resolveModelQualityCatalog(undefined);
}

export async function loadModelQualityLive(): Promise<ModelQualityBundle> {
  try {
    const index = await fetchOpenLlmLeaderboardIndex();
    return resolveModelQualityCatalog(index);
  } catch (err) {
    const notes = [
      `Hugging Face OLL refresh failed: ${err instanceof Error ? err.message : String(err)} — using YAML/static scores only`,
    ];
    const bundle = resolveModelQualityCatalog(undefined);
    bundle.provenance.notes.push(...notes);
    return bundle;
  }
}

function resolveModelQualityCatalog(
  leaderboard: Map<string, HuggingFaceLeaderboardScores> | undefined
): ModelQualityBundle {
  const yaml = loadYamlCatalog();
  const classById = new Map(yaml.equivalenceClasses.map((c) => [c.id, c]));
  let matched = 0;
  const entries: ResolvedModelQualityEntry[] = [];

  for (const e of yaml.entries) {
    const eq = classById.get(e.equivalenceClass);
    let hfScores: HuggingFaceLeaderboardScores | undefined;
    if (e.huggingFaceRepo && leaderboard) {
      hfScores = lookupLeaderboardScores(leaderboard, e.huggingFaceRepo);
      if (hfScores?.average !== undefined) matched += 1;
    }
    const { scores, source } = mergeScores(e.staticScores, hfScores);
    entries.push({
      catalogKey: e.catalogKey,
      equivalenceClass: e.equivalenceClass,
      equivalenceLabel: eq?.label ?? e.equivalenceClass,
      huggingFaceRepo: e.huggingFaceRepo,
      scores,
      scoreSource: source,
    });
  }

  const byCatalogKey: Record<string, ResolvedModelQualityEntry> = {};
  for (const entry of entries) {
    byCatalogKey[entry.catalogKey] = entry;
  }

  return {
    version: yaml.version,
    source: yaml.source,
    equivalenceClasses: yaml.equivalenceClasses,
    entries,
    byCatalogKey,
    provenance: {
      fetchedAt: new Date().toISOString(),
      huggingFaceLeaderboard: Boolean(leaderboard),
      leaderboardReposMatched: matched,
      notes: [],
    },
  };
}

export function managedCatalogKey(cloud: string, modelId: string): string {
  return `${cloud}:${modelId}`;
}

export function openWeightCatalogKey(modelId: string): string {
  return `open:${modelId}`;
}
