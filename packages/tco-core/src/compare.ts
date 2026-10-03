import { modelEquivalenceJudges, compareModelQuality } from "./model-equivalence.js";
import type { ModelQualityBundle } from "@tokenomics/pricing-data";
import { applyDeveloperPopulation } from "./apply-developer-population.js";
import { runJudges } from "./judges.js";
import { computeOpenShiftTco } from "./openshift-tco.js";
import { computeHyperscalerTco } from "./hyperscaler-tco.js";
import { resolveHyperscaler, withResolvedHyperscaler } from "./hyperscaler-resolve.js";
import {
  getModelThroughput,
  findManagedModel,
  getPricing,
  withPricing,
  type PricingBundle,
} from "./pricing-context.js";
import { applyGpuRecommendation, gpuSizingForScenario } from "./recommend-gpu.js";
import { computeUsageTotals } from "./usage.js";
import type { ComparisonResult, ScenarioInput } from "./types.js";

export { defaultComparisonScenario, defaultSla } from "./scenario-defaults.js";

export function evaluateScenario(
  scenario: ScenarioInput,
  pricingBundle?: PricingBundle,
  modelQuality?: ModelQualityBundle
): ComparisonResult {
  if (pricingBundle) {
    return withPricing(pricingBundle, () => evaluateScenarioCore(scenario, modelQuality));
  }
  return evaluateScenarioCore(scenario, modelQuality);
}

function evaluateScenarioCore(
  scenario: ScenarioInput,
  modelQuality?: ModelQualityBundle
): ComparisonResult {
  const pricing = getPricing();
  const { scenario: fromDevs, codingInfra } = applyDeveloperPopulation(scenario, pricing);
  const resolved = withResolvedHyperscaler(fromDevs);
  const usage = computeUsageTotals(resolved.workload, resolved.period, resolved.sla);
  const hyperscaler = resolveHyperscaler(resolved);

  const { scenario: withGpu, recommendation } = applyGpuRecommendation(
    resolved,
    usage,
    resolved.period
  );

  let gpuSizing;
  let maxContext: number | undefined;
  let minPhysicalGpusForModel: number | undefined;

  const needsGpu =
    withGpu.openshift ||
    (hyperscaler?.mode === "selfHostedGpu" && hyperscaler.gpuInstanceId);

  if (needsGpu) {
    const modelId =
      withGpu.openshift?.selfHostedModelId ??
      hyperscaler?.selfHostedModelId ??
      "llama-3-8b";
    const throughput = getModelThroughput(pricing, modelId);
    maxContext = throughput.maxContextTokens;
    minPhysicalGpusForModel = throughput.minPhysicalGpus;
    gpuSizing = gpuSizingForScenario(withGpu, usage, resolved.period, pricing);
  }

  if (hyperscaler?.mode === "managedApi" && hyperscaler.managedModelId) {
    const m = findManagedModel(pricing, hyperscaler.cloud, hyperscaler.managedModelId);
    maxContext = m?.maxContextTokens;
  }

  const judges = runJudges({
    scenario: withGpu,
    usage,
    gpuSizing,
    maxContextTokens: maxContext,
    bedrockRegion: hyperscaler?.region,
    minPhysicalGpusForModel,
    gpuRecommendation: recommendation,
  });

  if (modelQuality) {
    judges.push(...modelEquivalenceJudges(withGpu, modelQuality));
  }

  if (codingInfra) {
    if (codingInfra.decodeThroughputSource === "missing") {
      judges.push({
        id: "coding-decode-throughput-missing",
        severity: "error",
        message:
          "Selected coding model has no decode tok/s/GPU — set an editable override or fill the coding catalog.",
        suggestion:
          "Use Advanced → decodeTokensPerSecPerGpuOverride, or bridge to a measured open-weight model.",
      });
    }
    if (!codingInfra.selected) {
      judges.push({
        id: "coding-no-valid-topology",
        severity: "warning",
        message:
          "No GPU topology satisfies both memory fit and required decode throughput for this developer demand.",
        suggestion:
          "Raise decode tok/s assumption, pick a larger GPU SKU, or lower concurrency / target tok/s per user.",
      });
    } else if (codingInfra.selected.priceIsAssumption) {
      judges.push({
        id: "coding-gpu-price-assumption",
        severity: "info",
        message: `Selected ${codingInfra.selected.displayName} uses planning instance pricing.`,
        suggestion: "Replace rates in coding/gpu-infra.yaml before customer quotes.",
      });
    }
    for (const a of codingInfra.assumptions.slice(0, 2)) {
      judges.push({
        id: "coding-planning-assumption",
        severity: "info",
        message: a,
      });
    }
  }

  const modelQualityView = modelQuality
    ? compareModelQuality(withGpu, modelQuality)
    : undefined;

  let openshift;
  let hyperscalerTco;

  if (withGpu.openshift && gpuSizing) {
    openshift = computeOpenShiftTco({ scenario: withGpu, usage, gpuSizing });
  }

  if (hyperscaler) {
    hyperscalerTco = computeHyperscalerTco({ scenario: withGpu, usage, gpuSizing });
  }

  let deltaUsd: number | undefined;
  let cheaperPath: ComparisonResult["cheaperPath"];
  if (openshift && hyperscalerTco) {
    deltaUsd = openshift.totalUsd - hyperscalerTco.totalUsd;
    if (Math.abs(deltaUsd) < 0.01) cheaperPath = "tie";
    else cheaperPath = deltaUsd < 0 ? "openshift" : "hyperscaler";
  }

  const breakEven = computeBreakEvenRequests(
    withGpu,
    usage,
    openshift?.totalUsd,
    hyperscalerTco?.totalUsd
  );

  return {
    openshift,
    hyperscaler: hyperscalerTco,
    hyperscalerCloud: hyperscaler?.cloud,
    aws: hyperscaler?.cloud === "aws" ? hyperscalerTco : undefined,
    deltaUsd,
    cheaperPath,
    judges,
    breakEven,
    gpuRecommendation: recommendation,
    modelQuality: modelQualityView,
    codingInfra,
  };
}

function computeBreakEvenRequests(
  scenario: ScenarioInput,
  usageAtCurrent: ReturnType<typeof computeUsageTotals>,
  openshiftTotal?: number,
  hyperscalerTotal?: number
): ComparisonResult["breakEven"] {
  if (openshiftTotal === undefined || hyperscalerTotal === undefined) return undefined;
  const h = resolveHyperscaler(scenario);
  if (!h || h.mode !== "managedApi") return undefined;

  const fixedOcp = openshiftTotal;
  const varPerReq = estimateVariablePerRequest(scenario, usageAtCurrent);
  const fixedGap = fixedOcp;
  if (varPerReq <= 0) return undefined;

  const breakEvenRequests = fixedGap / varPerReq;
  return {
    metric: "requestsPerDay",
    currentValue: scenario.workload.requestsPerDay,
    breakEvenValue: breakEvenRequests / (usageAtCurrent.periodDays || 1),
    direction:
      scenario.workload.requestsPerDay < breakEvenRequests / usageAtCurrent.periodDays
        ? "below"
        : "above",
  };
}

function estimateVariableManaged(
  scenario: ScenarioInput,
  usage: ReturnType<typeof computeUsageTotals>
): number {
  const pricing = getPricing();
  const h = resolveHyperscaler(scenario);
  if (!h?.managedModelId) return 0;
  const model = findManagedModel(pricing, h.cloud, h.managedModelId);
  if (!model) return 0;
  return (
    (usage.inputTokens / 1_000_000) * model.inputPricePer1M +
    (usage.outputTokens / 1_000_000) * model.outputPricePer1M
  );
}

function estimateVariablePerRequest(
  scenario: ScenarioInput,
  usage: ReturnType<typeof computeUsageTotals>
): number {
  const variable = estimateVariableManaged(scenario, usage);
  const requests = Math.max(1, usage.llmRequests);
  return variable / requests;
}

export interface SensitivityPoint {
  parameter: string;
  value: number;
  openshiftTotal: number;
  hyperscalerTotal: number;
  /** @deprecated use hyperscalerTotal */
  awsTotal: number;
}

export function sensitivitySweep(
  base: ScenarioInput,
  parameter: "requestsPerDay" | "peakConcurrentRequests" | "utilizationTarget",
  values: number[],
  pricingBundle?: PricingBundle
): SensitivityPoint[] {
  return values.map((value) => {
    const scenario = structuredClone(base) as ScenarioInput;
    if (parameter === "requestsPerDay") {
      scenario.workload.requestsPerDay = value;
    } else if (parameter === "peakConcurrentRequests") {
      scenario.workload.peakConcurrentRequests = value;
    } else if (parameter === "utilizationTarget") {
      scenario.sla.utilizationTarget = value;
    }
    const result = pricingBundle
      ? evaluateScenario(scenario, pricingBundle)
      : evaluateScenarioCore(scenario);
    const hs = result.hyperscaler?.totalUsd ?? result.aws?.totalUsd ?? 0;
    return {
      parameter,
      value,
      openshiftTotal: result.openshift?.totalUsd ?? 0,
      hyperscalerTotal: hs,
      awsTotal: hs,
    };
  });
}

export function compareScenarios(scenarios: ScenarioInput[]): Array<{
  name: string;
  result: ComparisonResult;
}> {
  return scenarios.map((s) => ({ name: s.name, result: evaluateScenario(s) }));
}
