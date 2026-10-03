import type { GpuFleetSizing, LineItem, ScenarioInput, TcoBreakdown, UsageTotals } from "./types.js";
import {
  commitmentHourlyKey,
  findBedrockModel,
  findGpuInstance,
  getPricing,
  hoursInPeriod,
} from "./pricing-context.js";

export interface AwsTcoParams {
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

export function computeBedrockTco(params: AwsTcoParams): TcoBreakdown {
  const { scenario, usage } = params;
  const aws = scenario.aws;
  if (!aws?.bedrockModelId) throw new Error("bedrockModelId required");

  const pricing = getPricing();
  const model = findBedrockModel(pricing, aws.bedrockModelId);
  if (!model) throw new Error(`Unknown Bedrock model: ${aws.bedrockModelId}`);

  const lineItems: LineItem[] = [];
  const visibleOutputTokens = Math.max(0, usage.outputTokens - usage.thinkingTokens);

  const inputCost = (usage.inputTokens / 1_000_000) * model.inputPricePer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * model.outputPricePer1M;

  lineItems.push({
    id: "bedrock-input",
    label: `${model.displayName} input tokens`,
    category: "variable",
    amountUsd: inputCost,
    formula: "(inputTokens/1e6) * inputPricePer1M",
    notes:
      usage.thinkingAsInputTokens > 0
        ? `Includes ~${Math.round(usage.thinkingAsInputTokens)} prior thinking-as-input tokens`
        : undefined,
  });
  lineItems.push({
    id: "bedrock-output",
    label: `${model.displayName} output tokens (visible + thinking)`,
    category: "variable",
    amountUsd: outputCost,
    formula: "(outputTokens/1e6) * outputPricePer1M",
    notes:
      usage.thinkingTokens > 0
        ? `Thinking billed as output: ~${Math.round(usage.thinkingTokens)} tok; visible ~${Math.round(visibleOutputTokens)}`
        : "On Bedrock, extended thinking uses the output token rate—not a separate SKU",
  });

  if (usage.embeddingTokens > 0) {
    const embedId = aws.embeddingModelId ?? "amazon.titan-embed-text-v2";
    const embed =
      pricing.bedrock.embeddingModels.find((e) => e.id === embedId) ??
      pricing.bedrock.models.find((m) => m.isEmbedding);
    const embedPrice = embed?.inputPricePer1M ?? 0.02;
    lineItems.push({
      id: "bedrock-embeddings",
      label: "Bedrock embedding tokens",
      category: "variable",
      amountUsd: (usage.embeddingTokens / 1_000_000) * embedPrice,
    });
  }

  if (scenario.workload.kind === "rag" || scenario.workload.kind === "agentic") {
    const aux = pricing.openshiftAi.ragAuxDefaults;
    const months = usage.periodDays / 30;
    lineItems.push({
      id: "rag-vector-db-aws",
      label: "Vector store (OpenSearch / Kendra estimate)",
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

export function computeEc2SelfHostedTco(params: AwsTcoParams): TcoBreakdown {
  const { scenario, usage, gpuSizing } = params;
  if (!gpuSizing) throw new Error("gpuSizing required for EC2 path");
  const aws = scenario.aws;
  if (!aws?.gpuInstanceId) throw new Error("gpuInstanceId required");

  const pricing = getPricing();
  const gpuInstance = findGpuInstance(pricing, aws.gpuInstanceId);
  if (!gpuInstance) throw new Error(`Unknown GPU instance: ${aws.gpuInstanceId}`);

  const hours = hoursInPeriod(usage.periodDays);
  const key = commitmentHourlyKey(scenario.commitment);
  const gpuHourly = gpuInstance.hourlyUsd[key] ?? gpuInstance.hourlyUsd.onDemand;

  const lineItems: LineItem[] = [
    {
      id: "ec2-gpu",
      label: `EC2 GPU fleet (${gpuSizing.gpuNodes} × ${gpuInstance.id})`,
      category: "fixed",
      amountUsd: gpuSizing.gpuNodes * gpuHourly * hours,
    },
    {
      id: "ec2-ebs-estimate",
      label: "EBS / model storage estimate",
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

export function computeAwsTco(params: AwsTcoParams): TcoBreakdown {
  const mode = params.scenario.aws?.mode;
  if (mode === "bedrock") return computeBedrockTco(params);
  if (mode === "ec2") return computeEc2SelfHostedTco(params);
  throw new Error(`Unknown AWS mode: ${mode}`);
}
