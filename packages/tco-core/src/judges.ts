import { resolveHyperscaler } from "./hyperscaler-resolve.js";
import type {
  GpuFleetSizing,
  GpuInstanceRecommendation,
  JudgeWarning,
  ScenarioInput,
  UsageTotals,
} from "./types.js";

function usesManagedApi(scenario: ScenarioInput): boolean {
  const h = resolveHyperscaler(scenario);
  if (h) return h.mode === "managedApi";
  return scenario.aws?.mode === "bedrock";
}

const RAG_IO_RATIO_THRESHOLD = 10;

export interface JudgeContext {
  scenario: ScenarioInput;
  usage: UsageTotals;
  gpuSizing?: GpuFleetSizing;
  maxContextTokens?: number;
  bedrockRegion?: string;
  minPhysicalGpusForModel?: number;
  gpuRecommendation?: GpuInstanceRecommendation;
}

export function runJudges(ctx: JudgeContext): JudgeWarning[] {
  const warnings: JudgeWarning[] = [];
  const { scenario, usage, gpuSizing, maxContextTokens } = ctx;

  const rec = ctx.gpuRecommendation;
  if (
    rec &&
    !rec.autoApplied &&
    !rec.userInstanceAdequate &&
    scenario.openshift?.autoSelectGpuInstance === false
  ) {
    warnings.push({
      id: "gpu-instance-undersized",
      severity: "error",
      message: `Selected instance ${scenario.openshift.gpuInstanceId} is insufficient for ${scenario.openshift.selfHostedModelId} at this peak SLA.`,
      suggestion: `Use ${rec.instanceId} × ${rec.gpuNodes} nodes, or enable auto-select GPU.`,
    });
  }

  if (rec?.autoApplied) {
    warnings.push({
      id: "gpu-auto-selected",
      severity: "info",
      message: `GPU fleet auto-selected: ${rec.gpuNodes}× ${rec.instanceId} (${rec.physicalGpus} accelerators, ~$${rec.hourlyUsd.toFixed(2)}/hr inference).`,
      suggestion: rec.rationale[0],
    });
  }

  if (
    gpuSizing &&
    ctx.minPhysicalGpusForModel !== undefined &&
    gpuSizing.physicalGpus < ctx.minPhysicalGpusForModel
  ) {
    warnings.push({
      id: "insufficient-gpus-for-model",
      severity: "error",
      message: `Selected open-weight model needs at least ${ctx.minPhysicalGpusForModel} physical GPU(s); fleet has ${gpuSizing.physicalGpus}.`,
      suggestion: "Use a larger instance type, more nodes, or a smaller model (e.g. 8B on g6.2xlarge).",
    });
  }

  if (gpuSizing && gpuSizing.impliedUtilization < 0.2) {
    warnings.push({
      id: "low-gpu-utilization",
      severity: "warning",
      message: `Average GPU utilization implied by token volume is ~${(gpuSizing.impliedUtilization * 100).toFixed(1)}% (< 20%). Fleet is likely sized for peak SLA, not average load.`,
      suggestion:
        "Compare peak-sized vs right-sized fleet costs, or reduce GPU nodes if latency SLA allows.",
    });
  }

  if (
    scenario.workload.kind === "rag" &&
    usage.inputOutputRatio > RAG_IO_RATIO_THRESHOLD &&
    maxContextTokens !== undefined &&
    scenario.workload.avgInputTokensPerRequest > maxContextTokens
  ) {
    warnings.push({
      id: "context-overflow",
      severity: "error",
      message: `RAG avg input (${scenario.workload.avgInputTokensPerRequest} tokens) exceeds model context (${maxContextTokens}).`,
      suggestion: "Use a larger context model or reduce retrieved chunk size.",
    });
  } else if (
    scenario.workload.kind === "rag" &&
    usage.inputOutputRatio > RAG_IO_RATIO_THRESHOLD &&
    maxContextTokens !== undefined &&
    scenario.workload.avgInputTokensPerRequest > maxContextTokens * 0.9
  ) {
    warnings.push({
      id: "context-near-limit",
      severity: "warning",
      message: "RAG input tokens are near model context limit; truncation risk under load.",
    });
  }

  if (scenario.openshift?.platform === "aro" && scenario.aws?.region.startsWith("us-")) {
    warnings.push({
      id: "cross-cloud-compare",
      severity: "warning",
      message:
        "ARO runs on Azure while AWS Bedrock/ROSA paths use AWS. Cross-cloud egress, latency, and compliance are not fully priced.",
      suggestion: "Compare ROSA+Bedrock vs ARO+Azure OpenAI for same-cloud fairness.",
    });
  }

  if (
    scenario.openshift?.licensingMode === "managedCloudService" &&
    (scenario.openshift.customPrices?.openshiftAiMonthlyUsd ?? 0) === 0
  ) {
    warnings.push({
      id: "missing-oai-quote",
      severity: "info",
      message: "OpenShift AI managed service price is $0 — enter your Marketplace quote for accurate totals.",
    });
  }

  if (
    scenario.workload.kind === "agentic" &&
    (scenario.workload.avgThinkingTokensPerRequest ?? 0) < 3000
  ) {
    warnings.push({
      id: "agentic-low-thinking",
      severity: "warning",
      message:
        "Agentic AIOps/troubleshooting workloads usually incur large reasoning (thinking) token volume per step. Low thinking input may understate Bedrock cost.",
      suggestion: "Use observability from agents (e.g. 8k–20k thinking tokens per LLM call) or enable extended thinking on the API path.",
    });
  }

  if (scenario.workload.kind === "agentic" && scenario.workload.avgInputTokensPerRequest < 15000) {
    warnings.push({
      id: "agentic-low-context",
      severity: "info",
      message:
        "Agentic runs often carry logs, metrics, runbooks, and tool results in context (20k–80k+ tokens per step).",
    });
  }

  if (scenario.workload.kind === "maas" && scenario.workload.peakConcurrentRequests < 50) {
    warnings.push({
      id: "maas-low-peak-concurrency",
      severity: "warning",
      message:
        "MaaS platforms are usually sized on peak concurrent API calls across tenants; low peak may understate GPU fleet.",
      suggestion: "Set peak concurrent from gateway metrics (p95 in-flight requests) or load-test targets.",
    });
  }

  if (
    scenario.workload.kind === "maas" &&
    usesManagedApi(scenario) &&
    usage.llmRequests > 0
  ) {
    const perDay = usage.llmRequests / usage.periodDays;
    if (perDay >= 50_000) {
      warnings.push({
        id: "maas-bedrock-scale",
        severity: "info",
        message: `MaaS volume (~${Math.round(perDay).toLocaleString()} API calls/day) is often where private inference on OpenShift AI breaks even vs per-token Bedrock.`,
        suggestion:
          "Compare implied $/1M output on OpenShift with Bedrock list; factor in gateway HA and model ops overhead.",
      });
    }
  }

  if (
    usesManagedApi(scenario) &&
    (scenario.workload.avgThinkingTokensPerRequest ?? 0) === 0 &&
    scenario.workload.kind === "codeAssistant"
  ) {
    warnings.push({
      id: "thinking-not-modeled",
      severity: "info",
      message:
        "Extended thinking tokens are not modeled (0 avg thinking tokens/request). On Bedrock they bill at the output token rate and can dominate cost for reasoning models.",
      suggestion:
        "Set avg thinking tokens from usage.output_tokens_details.thinking_tokens or your budget_tokens average.",
    });
  }

  if (
    (scenario.workload.avgThinkingTokensPerRequest ?? 0) > 0 &&
    scenario.workload.avgOutputTokensPerRequest > 0 &&
    usesManagedApi(scenario)
  ) {
    warnings.push({
      id: "thinking-double-count",
      severity: "warning",
      message:
        "You set both avg output and avg thinking tokens. Ensure output is user-visible tokens only—thinking is added separately in usage math.",
    });
  }

  const h = resolveHyperscaler(scenario);
  if (usage.embeddingTokens > 0 && usesManagedApi(scenario) && !h?.embeddingModelId && !scenario.aws?.embeddingModelId) {
    warnings.push({
      id: "embedding-not-priced",
      severity: "warning",
      message: "Workload generates embedding tokens but no Bedrock embedding model is selected.",
    });
  }

  const accelPrice = scenario.openshift?.customPrices?.aiAcceleratorUsdPerGpuYear;
  if (scenario.openshift && accelPrice === undefined && gpuSizing) {
    warnings.push({
      id: "missing-accelerator-quote",
      severity: "info",
      message: `Physical GPUs billed: ${gpuSizing.physicalGpus}. Red Hat AI Accelerator SKU is 1 per physical GPU — add annual $/GPU if you have a quote.`,
    });
  }

  return warnings;
}
