import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MANAGED_MODEL,
  DEFAULT_REGION,
} from "./cloud-presets.js";
import type { ScenarioInput, SlaConfig, WorkloadProfile } from "./types.js";

export function defaultSla(): SlaConfig {
  return {
    maxLatencySeconds: 30,
    utilizationTarget: 0.65,
    haExtraNodes: 1,
    tokenCountFudgeFactor: 1.02,
  };
}

export function defaultComparisonScenario(
  workload: WorkloadProfile,
  overrides?: Partial<ScenarioInput>
): ScenarioInput {
  return {
    name: "Default comparison",
    workload,
    period: { unit: "year", count: 1 },
    sla: defaultSla(),
    commitment: "oneYear",
    openshift: {
      platform: "rosa",
      licensingMode: "managedCloudService",
      useHcp: true,
      gpuInstanceId: "g6.2xlarge",
      selfHostedModelId: "llama-3-8b",
      region: "us-east-1",
      customPrices: {},
      autoSelectGpuInstance: true,
    },
    hyperscaler: {
      cloud: "aws",
      region: DEFAULT_REGION.aws,
      mode: "managedApi",
      managedModelId: DEFAULT_MANAGED_MODEL.aws,
      embeddingModelId: DEFAULT_EMBEDDING_MODEL.aws,
    },
    ...overrides,
  };
}
