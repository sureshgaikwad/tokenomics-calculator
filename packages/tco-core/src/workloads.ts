import type { WorkloadProfile, WorkloadKind } from "./types.js";

export const WORKLOAD_TEMPLATES: Record<string, WorkloadProfile> = {
  rag: {
    kind: "rag",
    requestsPerDay: 5000,
    avgInputTokensPerRequest: 12000,
    avgOutputTokensPerRequest: 800,
    peakConcurrentRequests: 10,
    activeHoursFraction: 0.4,
    embeddingTokensPerLlmRequest: 500,
    monthlyCorpusEmbeddingTokens: 50_000_000,
    embeddingOnlyRequestFraction: 0.05,
  },
  codeAssistant: {
    kind: "codeAssistant",
    requestsPerDay: 8000,
    avgInputTokensPerRequest: 2500,
    avgOutputTokensPerRequest: 1200,
    peakConcurrentRequests: 120,
    activeHoursFraction: 0.5,
    embeddingTokensPerLlmRequest: 0,
    monthlyCorpusEmbeddingTokens: 0,
    embeddingOnlyRequestFraction: 0,
  },
  batch: {
    kind: "batch",
    requestsPerDay: 500,
    avgInputTokensPerRequest: 8000,
    avgOutputTokensPerRequest: 2000,
    peakConcurrentRequests: 10,
    activeHoursFraction: 0.25,
    embeddingTokensPerLlmRequest: 0,
    monthlyCorpusEmbeddingTokens: 0,
    embeddingOnlyRequestFraction: 0,
  },
  /**
   * AIOps / troubleshooting agents: many tool loops, large observability context,
   * heavy reasoning (thinking) per LLM step. requestsPerDay = LLM round-trips
   * (workflows × calls per workflow).
   */
  agentic: {
    kind: "agentic",
    agentWorkflowsPerDay: 120,
    llmCallsPerWorkflow: 15,
    requestsPerDay: 1800,
    avgInputTokensPerRequest: 32000,
    avgOutputTokensPerRequest: 900,
    avgThinkingTokensPerRequest: 12000,
    thinkingBlocksAsInputFraction: 0.35,
    peakConcurrentRequests: 20,
    activeHoursFraction: 0.5,
    embeddingTokensPerLlmRequest: 400,
    monthlyCorpusEmbeddingTokens: 5_000_000,
    embeddingOnlyRequestFraction: 0.02,
  },
  /**
   * Models as a Service (MaaS): shared OpenAI-compatible inference platform
   * for many internal apps. requestsPerDay = total API invocations across tenants.
   */
  maas: {
    kind: "maas",
    maasConsumerCount: 30,
    requestsPerDay: 150_000,
    avgInputTokensPerRequest: 3500,
    avgOutputTokensPerRequest: 650,
    peakConcurrentRequests: 320,
    activeHoursFraction: 0.9,
    embeddingTokensPerLlmRequest: 0,
    monthlyCorpusEmbeddingTokens: 0,
    embeddingOnlyRequestFraction: 0,
  },
};

export function getWorkloadTemplate(kind: WorkloadKind): WorkloadProfile {
  const template = WORKLOAD_TEMPLATES[kind];
  if (!template) {
    return { ...WORKLOAD_TEMPLATES.rag };
  }
  return { ...template };
}
