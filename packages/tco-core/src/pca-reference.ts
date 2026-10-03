import { loadPcaReferencePhases, type PcaReferencePhase } from "@tokenomics/pricing-data";
import { defaultSla } from "./scenario-defaults.js";
import type { ScenarioInput, WorkloadKind, WorkloadProfile } from "./types.js";

export function getPcaPhaseCatalog() {
  return loadPcaReferencePhases();
}

export function listPcaPhases(): PcaReferencePhase[] {
  return loadPcaReferencePhases().phases;
}

export function scenarioFromPcaPhase(phaseId: string): ScenarioInput {
  const catalog = loadPcaReferencePhases();
  const phase = catalog.phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`Unknown PCA phase: ${phaseId}`);

  const primaryInstance = phase.fleet[0]?.instanceId ?? "g6e.2xlarge";
  const w = phase.workload;

  const workload: WorkloadProfile = {
    kind: w.kind as WorkloadKind,
    requestsPerDay: w.requestsPerDay,
    peakConcurrentRequests: w.peakConcurrentRequests,
    avgInputTokensPerRequest: w.avgInputTokensPerRequest,
    avgOutputTokensPerRequest: w.avgOutputTokensPerRequest,
    activeHoursFraction: w.activeHoursFraction,
    avgThinkingTokensPerRequest: w.avgThinkingTokensPerRequest ?? 0,
    embeddingTokensPerLlmRequest: 0,
    monthlyCorpusEmbeddingTokens: 0,
    embeddingOnlyRequestFraction: 0,
  };

  return {
    name: phase.name,
    workload,
    period: { unit: "year", count: 1 },
    sla: defaultSla(),
    commitment: "onDemand",
    openshift: {
      platform: "rosa",
      licensingMode: "managedCloudService",
      region: "us-east-2",
      useHcp: phase.openshift.useHcp,
      workerCount: phase.openshift.workerCount,
      gpuInstanceId: primaryInstance,
      selfHostedModelId: phase.openshift.selfHostedModelId,
      inferenceFleet: phase.fleet,
      customStackHourlyUsd: phase.openshift.customStackHourlyUsd,
      autoSelectGpuInstance: false,
      customPrices: {},
    },
    aws: {
      mode: "bedrock",
      bedrockModelId: catalog.bedrockComparisonDefaults.bedrockModelId,
      embeddingModelId: catalog.bedrockComparisonDefaults.embeddingModelId,
      region: catalog.bedrockComparisonDefaults.region,
    },
  };
}

export interface PcaPhaseSummary {
  id: string;
  name: string;
  status: string;
  devCapacity: string;
  benchmark: PcaReferencePhase["benchmark"];
  fleet: PcaReferencePhase["fleet"];
  modelId: string;
}

export function summarizePcaPhases(): PcaPhaseSummary[] {
  return listPcaPhases().map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    devCapacity: p.devCapacity,
    benchmark: p.benchmark,
    fleet: p.fleet,
    modelId: p.openshift.selfHostedModelId,
  }));
}
