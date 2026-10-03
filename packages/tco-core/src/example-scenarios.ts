import { defaultComparisonScenario } from "./scenario-defaults.js";
import { getWorkloadTemplate } from "./workloads.js";
import type { ScenarioInput } from "./types.js";

/** Curated inputs for demos: API wins vs self-hosted OpenShift wins */
export const EXAMPLE_SCENARIOS: Record<string, ScenarioInput> = {
  apiWinsLowVolume: (() => {
    const workload = getWorkloadTemplate("codeAssistant");
    workload.requestsPerDay = 200;
    workload.peakConcurrentRequests = 3;
    workload.avgInputTokensPerRequest = 2000;
    workload.avgOutputTokensPerRequest = 600;
    return defaultComparisonScenario(workload, {
      name: "API wins — low volume",
      period: { unit: "month", count: 1 },
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        useHcp: true,
        gpuInstanceId: "g6.2xlarge",
        selfHostedModelId: "llama-3-8b",
        workerCount: 3,
        region: "us-east-1",
      },
      aws: {
        mode: "bedrock",
        bedrockModelId: "anthropic.claude-3-5-sonnet",
        embeddingModelId: "amazon.titan-embed-text-v2",
        region: "us-east-1",
      },
    });
  })(),
  openshiftWinsHighRag: (() => {
    const workload = getWorkloadTemplate("rag");
    workload.requestsPerDay = 25_000;
    workload.peakConcurrentRequests = 10;
    workload.avgInputTokensPerRequest = 12000;
    workload.avgOutputTokensPerRequest = 800;
    workload.avgThinkingTokensPerRequest = 0;
    return defaultComparisonScenario(workload, {
      name: "OpenShift wins — sustained RAG vs Sonnet",
      period: { unit: "year", count: 1 },
      commitment: "oneYear",
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        useHcp: false,
        gpuInstanceId: "g6.2xlarge",
        selfHostedModelId: "llama-3-8b",
        workerCount: 3,
        region: "us-east-1",
      },
      aws: {
        mode: "bedrock",
        bedrockModelId: "anthropic.claude-3-5-sonnet",
        embeddingModelId: "amazon.titan-embed-text-v2",
        region: "us-east-1",
      },
    });
  })(),
  openshiftWinsWithThinking: (() => {
    const workload = getWorkloadTemplate("codeAssistant");
    workload.requestsPerDay = 15_000;
    workload.peakConcurrentRequests = 15;
    workload.avgInputTokensPerRequest = 3000;
    workload.avgOutputTokensPerRequest = 1500;
    workload.avgThinkingTokensPerRequest = 4000;
    return defaultComparisonScenario(workload, {
      name: "OpenShift wins — high volume + thinking on Bedrock",
      period: { unit: "year", count: 1 },
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        region: "us-east-1",
        gpuInstanceId: "g5.2xlarge",
        selfHostedModelId: "llama-3-8b",
        useHcp: false,
        workerCount: 3,
      },
      aws: {
        mode: "bedrock",
        bedrockModelId: "anthropic.claude-3-7-sonnet",
        region: "us-east-1",
      },
    });
  })(),
};
