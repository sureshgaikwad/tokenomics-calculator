import type { GpuFleetSizing, LineItem, ScenarioInput, TcoBreakdown, UsageTotals } from "./types.js";
import { resolveHyperscaler } from "./hyperscaler-resolve.js";
import { computeAwsTco } from "./aws-tco.js";
import {
  commitmentHourlyKey,
  findCloudGpuInstance,
  findEmbeddingPricePer1M,
  findManagedModel,
  getPricing,
  hoursInPeriod,
} from "./pricing-context.js";

export interface HyperscalerTcoParams {
  scenario: ScenarioInput;
  usage: UsageTotals;
  gpuSizing?: GpuFleetSizing;
}

function sumLineItems(items: LineItem[]): { total: number; fixed: number; variable: number } {
  let fixed = 0;
  let variable = 0;
  for (const item of items) {
    if (item.category === "fixed") fixed += item.amountUsd;
    else variable += item.amountUsd;
  }
  return { total: fixed + variable, fixed, variable };
}

function toAwsScenario(scenario: ScenarioInput): ScenarioInput {
  const h = resolveHyperscaler(scenario);
  if (!h || h.cloud !== "aws") throw new Error("Not AWS hyperscaler");
  return {
    ...scenario,
    aws: {
      mode: h.mode === "managedApi" ? "bedrock" : "ec2",
      region: h.region,
      bedrockModelId: h.managedModelId,
      embeddingModelId: h.embeddingModelId,
      gpuInstanceId: h.gpuInstanceId,
      selfHostedModelId: h.selfHostedModelId,
    },
  };
}

function computeManagedApiTco(params: HyperscalerTcoParams): TcoBreakdown {
  const { scenario, usage } = params;
  const h = resolveHyperscaler(scenario);
  if (!h?.managedModelId) throw new Error("managedModelId required");

  const pricing = getPricing();
  const model = findManagedModel(pricing, h.cloud, h.managedModelId);
  if (!model) throw new Error(`Unknown model: ${h.managedModelId} on ${h.cloud}`);

  const lineItems: LineItem[] = [];
  const visibleOutputTokens = Math.max(0, usage.outputTokens - usage.thinkingTokens);

  lineItems.push({
    id: "managed-input",
    label: `${model.displayName} input tokens`,
    category: "variable",
    amountUsd: (usage.inputTokens / 1_000_000) * model.inputPricePer1M,
  });
  lineItems.push({
    id: "managed-output",
    label: `${model.displayName} output tokens (visible + thinking)`,
    category: "variable",
    amountUsd: (usage.outputTokens / 1_000_000) * model.outputPricePer1M,
    notes:
      usage.thinkingTokens > 0
        ? `Thinking ~${Math.round(usage.thinkingTokens)} tok; visible ~${Math.round(visibleOutputTokens)}`
        : undefined,
  });

  if (usage.embeddingTokens > 0) {
    const embedPrice = findEmbeddingPricePer1M(pricing, h.cloud, h.embeddingModelId);
    lineItems.push({
      id: "managed-embeddings",
      label: "Embedding tokens",
      category: "variable",
      amountUsd: (usage.embeddingTokens / 1_000_000) * embedPrice,
    });
  }

  if (scenario.workload.kind === "rag" || scenario.workload.kind === "agentic") {
    const aux = pricing.openshiftAi.ragAuxDefaults;
    const months = usage.periodDays / 30;
    lineItems.push({
      id: "rag-vector-db-cloud",
      label: "Vector store (managed search estimate)",
      category: "fixed",
      amountUsd: aux.vectorDbMonthlyUsd * months,
    });
  }

  const { total, fixed, variable } = sumLineItems(lineItems);
  return {
    lineItems,
    totalUsd: total,
    fixedUsd: fixed,
    variableUsd: variable,
    impliedUsdPer1MInputTokens:
      usage.inputTokens > 0 ? (total / usage.inputTokens) * 1_000_000 : undefined,
    impliedUsdPer1MOutputTokens:
      usage.outputTokens > 0 ? (total / usage.outputTokens) * 1_000_000 : undefined,
  };
}

function computeSelfHostedGpuTco(params: HyperscalerTcoParams): TcoBreakdown {
  const { scenario, usage, gpuSizing } = params;
  if (!gpuSizing) throw new Error("gpuSizing required for self-hosted GPU path");
  const h = resolveHyperscaler(scenario);
  if (!h?.gpuInstanceId) throw new Error("gpuInstanceId required");

  const pricing = getPricing();
  const gpuInstance = findCloudGpuInstance(pricing, h.cloud, h.gpuInstanceId);
  if (!gpuInstance) throw new Error(`Unknown GPU instance: ${h.gpuInstanceId} on ${h.cloud}`);

  const hours = hoursInPeriod(usage.periodDays);
  const key = commitmentHourlyKey(scenario.commitment);
  const gpuHourly = gpuInstance.hourlyUsd[key] ?? gpuInstance.hourlyUsd.onDemand;

  const cloudLabel =
    h.cloud === "aws" ? "EC2" : h.cloud === "azure" ? "Azure VM" : "GCE";

  const lineItems: LineItem[] = [
    {
      id: "cloud-gpu-fleet",
      label: `${cloudLabel} GPU fleet (${gpuSizing.gpuNodes} × ${gpuInstance.id})`,
      category: "fixed",
      amountUsd: gpuSizing.gpuNodes * gpuHourly * hours,
    },
    {
      id: "cloud-gpu-storage",
      label: "Disk / model storage estimate",
      category: "fixed",
      amountUsd: gpuSizing.gpuNodes * 200 * 0.08 * (hours / 730),
    },
  ];

  const { total, fixed, variable } = sumLineItems(lineItems);
  return {
    lineItems,
    totalUsd: total,
    fixedUsd: fixed,
    variableUsd: variable,
    impliedUsdPer1MInputTokens:
      usage.inputTokens > 0 ? (total / usage.inputTokens) * 1_000_000 : undefined,
    impliedUsdPer1MOutputTokens:
      usage.outputTokens > 0 ? (total / usage.outputTokens) * 1_000_000 : undefined,
  };
}

export function computeHyperscalerTco(params: HyperscalerTcoParams): TcoBreakdown {
  const h = resolveHyperscaler(params.scenario);
  if (!h) throw new Error("hyperscaler config required");

  if (h.cloud === "aws") {
    return computeAwsTco({ ...params, scenario: toAwsScenario(params.scenario) });
  }

  if (h.mode === "managedApi") return computeManagedApiTco(params);
  return computeSelfHostedGpuTco(params);
}
