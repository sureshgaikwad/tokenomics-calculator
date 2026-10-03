import type {
  CodingCatalogBundle,
  CodingGpuInstance,
  CodingModel,
  OpenWeightModel,
} from "@tokenomics/pricing-data";
import {
  findCodingGpuType,
  findFrontierModel,
} from "@tokenomics/pricing-data";
import type { DeveloperDemandResult } from "./developer-demand.js";
import type { CommitmentTerm } from "./types.js";

export interface MemoryBreakdown {
  weightMemoryGb: number;
  kvCacheMemoryGb: number;
  runtimeOverheadGb: number;
  safetyMarginGb: number;
  requiredVramGb: number;
  kvMode: "per-sequence-assumption" | "architecture-unavailable";
  notes: string[];
}

export interface TopologyCandidate {
  instanceId: string;
  displayName: string;
  cloudProvider: string;
  gpusPerInstance: number;
  gpuName: string;
  usableMemoryPerGpuGb: number;
  usableMemoryPerReplicaGb: number;
  replicasForMemory: number;
  replicasForThroughput: number;
  replicasForTopology: number;
  haExtraReplicas: number;
  totalReplicas: number;
  totalGpus: number;
  totalInstances: number;
  decodeTokensPerSecPerGpu: number;
  decodeTokensPerSecPerReplica: number;
  totalDecodeTokensPerSec: number;
  memoryOk: boolean;
  throughputOk: boolean;
  valid: boolean;
  hourlyUsd: number;
  annualUsd: number;
  priceIsAssumption?: boolean;
  invalidReasons: string[];
}

export interface CodingInfraSizingResult {
  demand: DeveloperDemandResult;
  model: {
    modelId: string;
    modelName: string;
    weightMemoryIsAssumption?: boolean;
    throughputIsAssumption?: boolean;
    frontierComparison: {
      frontierModelId: string;
      frontierDisplayName: string;
      classification: string;
      evidenceNote?: string;
    };
  };
  memory: MemoryBreakdown;
  decodeTokensPerSecPerGpuUsed: number;
  decodeThroughputSource: "catalog" | "open-weight-bridge" | "override" | "missing";
  candidates: TopologyCandidate[];
  selected?: TopologyCandidate;
  assumptions: string[];
}

function commitmentKey(
  commitment: CommitmentTerm
): "onDemand" | "oneYear" | "threeYear" | "spot" {
  if (commitment === "oneYear") return "oneYear";
  if (commitment === "threeYear") return "threeYear";
  if (commitment === "spot") return "spot";
  return "onDemand";
}

export function computeMemoryBreakdown(
  model: CodingModel,
  demand: DeveloperDemandResult
): MemoryBreakdown {
  const notes: string[] = [];
  const weight = model.weightMemoryGb;
  if (model.weightMemoryIsAssumption) {
    notes.push("Model weight memory is an editable planning assumption.");
  }

  // Architecture-specific KV calc not available for most catalog entries yet.
  const kvMode = "per-sequence-assumption" as const;
  notes.push(
    `KV cache uses configurable ${demand.kvCacheGbPerActiveSequence} GB per concurrent sequence (not architecture-exact).`
  );
  const kvCacheMemoryGb =
    demand.concurrentRequests * demand.kvCacheGbPerActiveSequence;

  const base = weight + kvCacheMemoryGb;
  const runtimeOverheadGb = base * demand.runtimeOverheadFraction;
  const beforeMargin = base + runtimeOverheadGb;
  const safetyMarginGb = beforeMargin * demand.safetyMarginFraction;
  const requiredVramGb = beforeMargin + safetyMarginGb;

  return {
    weightMemoryGb: weight,
    kvCacheMemoryGb,
    runtimeOverheadGb,
    safetyMarginGb,
    requiredVramGb,
    kvMode,
    notes,
  };
}

function resolveDecodeThroughput(
  model: CodingModel,
  openWeight: OpenWeightModel | undefined,
  override?: number
): { tps: number | undefined; source: CodingInfraSizingResult["decodeThroughputSource"] } {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return { tps: override, source: "override" };
  }
  if (
    model.estimatedDecodeThroughputTokPerSecPerGpu !== null &&
    model.estimatedDecodeThroughputTokPerSecPerGpu !== undefined &&
    model.estimatedDecodeThroughputTokPerSecPerGpu > 0
  ) {
    return {
      tps: model.estimatedDecodeThroughputTokPerSecPerGpu,
      source: "catalog",
    };
  }
  const bridge =
    openWeight?.sustainedOutputTpsPerGpu ?? openWeight?.outputTokensPerSecPerGpu;
  if (bridge !== undefined && bridge > 0) {
    return { tps: bridge, source: "open-weight-bridge" };
  }
  return { tps: undefined, source: "missing" };
}

function evaluateInstance(
  instance: CodingGpuInstance,
  catalog: CodingCatalogBundle,
  model: CodingModel,
  demand: DeveloperDemandResult,
  memory: MemoryBreakdown,
  decodePerGpu: number,
  commitment: CommitmentTerm,
  haExtraReplicas: number
): TopologyCandidate {
  const gpu = findCodingGpuType(catalog.gpuInfra, instance.gpuId);
  const gpuMemory = gpu?.gpuMemoryGb ?? 0;
  const usableFactor = gpu?.usableMemoryFactor ?? 0.9;
  const usableMemoryPerGpuGb = gpuMemory * usableFactor;
  const gpusPerReplica = Math.max(
    model.tensorParallelRequirement,
    model.minimumGpuCount,
    1
  );

  // One serving replica = tensor-parallel group that must fit on one or more instances
  const gpusPerInstance = instance.gpusPerInstance;
  const instancesPerReplica = Math.ceil(gpusPerReplica / gpusPerInstance);
  const gpusAllocatedPerReplica = instancesPerReplica * gpusPerInstance;
  const usableMemoryPerReplicaGb = usableMemoryPerGpuGb * gpusAllocatedPerReplica;

  const invalidReasons: string[] = [];
  if (!gpu) invalidReasons.push(`Unknown GPU type ${instance.gpuId}`);
  if (gpuMemory < model.minimumGpuMemoryGb) {
    invalidReasons.push(
      `GPU ${gpu?.gpuName ?? instance.gpuId} ${gpuMemory}GB < model minimum ${model.minimumGpuMemoryGb}GB`
    );
  }

  const memoryOk = usableMemoryPerReplicaGb >= memory.requiredVramGb;
  if (!memoryOk) {
    invalidReasons.push(
      `Replica usable VRAM ${usableMemoryPerReplicaGb.toFixed(1)}GB < required ${memory.requiredVramGb.toFixed(1)}GB`
    );
  }

  // Memory may force multiple replicas if a single replica can't hold KV+weights
  // (we already require one replica to hold full requiredVram — if not, invalid)
  const replicasForMemory = memoryOk ? 1 : 0;

  const decodePerReplica = decodePerGpu * gpusAllocatedPerReplica;
  const replicasForThroughput =
    decodePerReplica > 0
      ? Math.ceil(demand.requiredOutputTokensPerSec / decodePerReplica)
      : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(replicasForThroughput) || replicasForThroughput <= 0) {
    invalidReasons.push("Decode throughput per replica is zero or unknown.");
  }

  const replicasForTopology = Math.max(
    replicasForMemory,
    Number.isFinite(replicasForThroughput) ? replicasForThroughput : 0,
    1
  );
  const throughputOk =
    Number.isFinite(replicasForThroughput) &&
    decodePerReplica * replicasForTopology >= demand.requiredOutputTokensPerSec;

  if (!throughputOk) {
    invalidReasons.push(
      `Throughput ${decodePerReplica.toFixed(0)} tok/s/replica × ${replicasForTopology} < required ${demand.requiredOutputTokensPerSec}`
    );
  }

  const totalReplicas = replicasForTopology + haExtraReplicas;
  const totalInstances = totalReplicas * instancesPerReplica;
  const totalGpus = totalInstances * gpusPerInstance;
  const hourly =
    instance.instanceHourlyCost[commitmentKey(commitment)] ??
    instance.instanceHourlyCost.onDemand ??
    0;

  const valid = memoryOk && throughputOk && invalidReasons.length === 0;

  return {
    instanceId: instance.id,
    displayName: instance.displayName,
    cloudProvider: instance.cloudProvider,
    gpusPerInstance,
    gpuName: gpu?.gpuName ?? instance.gpuId,
    usableMemoryPerGpuGb,
    usableMemoryPerReplicaGb,
    replicasForMemory,
    replicasForThroughput: Number.isFinite(replicasForThroughput)
      ? replicasForThroughput
      : 0,
    replicasForTopology,
    haExtraReplicas,
    totalReplicas,
    totalGpus,
    totalInstances,
    decodeTokensPerSecPerGpu: decodePerGpu,
    decodeTokensPerSecPerReplica: decodePerReplica,
    totalDecodeTokensPerSec: decodePerReplica * totalReplicas,
    memoryOk,
    throughputOk,
    valid,
    hourlyUsd: hourly * totalInstances,
    annualUsd: hourly * totalInstances * 8760,
    priceIsAssumption: instance.priceIsAssumption,
    invalidReasons,
  };
}

/**
 * Size GPU infrastructure from concurrent request demand.
 * A topology is valid only if BOTH memory fit AND decode throughput are satisfied.
 */
export function sizeCodingInfrastructure(opts: {
  demand: DeveloperDemandResult;
  model: CodingModel;
  catalog: CodingCatalogBundle;
  openWeightBridge?: OpenWeightModel;
  commitment: CommitmentTerm;
  haExtraReplicas?: number;
  decodeTokensPerSecPerGpuOverride?: number;
  preferredInstanceIds?: string[];
}): CodingInfraSizingResult {
  const {
    demand,
    model,
    catalog,
    openWeightBridge,
    commitment,
    haExtraReplicas = 1,
    decodeTokensPerSecPerGpuOverride,
  } = opts;

  const memory = computeMemoryBreakdown(model, demand);
  const { tps, source } = resolveDecodeThroughput(
    model,
    openWeightBridge,
    decodeTokensPerSecPerGpuOverride
  );

  const assumptions: string[] = [
    "All intensity and concurrency ratios are planning assumptions, not guaranteed production performance.",
    ...memory.notes,
  ];
  if (model.throughputIsAssumption || source === "missing" || source === "override") {
    assumptions.push(
      "Decode throughput is an editable planning assumption unless sourced from an existing project catalog measurement."
    );
  }

  const frontier = findFrontierModel(
    catalog.frontier,
    model.frontierComparison.frontierModelId
  );

  if (tps === undefined) {
    return {
      demand,
      model: {
        modelId: model.modelId,
        modelName: model.modelName,
        weightMemoryIsAssumption: model.weightMemoryIsAssumption,
        throughputIsAssumption: model.throughputIsAssumption,
        frontierComparison: {
          frontierModelId: model.frontierComparison.frontierModelId,
          frontierDisplayName: frontier?.displayName ?? model.frontierComparison.frontierModelId,
          classification: model.frontierComparison.classification,
          evidenceNote: model.frontierComparison.evidenceNote,
        },
      },
      memory,
      decodeTokensPerSecPerGpuUsed: 0,
      decodeThroughputSource: source,
      candidates: [],
      selected: undefined,
      assumptions: [
        ...assumptions,
        "No decode tok/s/GPU available — set decodeTokensPerSecPerGpuOverride or fill coding-models.yaml.",
      ],
    };
  }

  const candidates = catalog.gpuInfra.instances
    .map((inst) =>
      evaluateInstance(
        inst,
        catalog,
        model,
        demand,
        memory,
        tps,
        commitment,
        haExtraReplicas
      )
    )
    .sort((a, b) => {
      if (a.valid !== b.valid) return a.valid ? -1 : 1;
      return a.annualUsd - b.annualUsd;
    });

  const selected = candidates.find((c) => c.valid);

  return {
    demand,
    model: {
      modelId: model.modelId,
      modelName: model.modelName,
      weightMemoryIsAssumption: model.weightMemoryIsAssumption,
      throughputIsAssumption: model.throughputIsAssumption,
      frontierComparison: {
        frontierModelId: model.frontierComparison.frontierModelId,
        frontierDisplayName: frontier?.displayName ?? model.frontierComparison.frontierModelId,
        classification: model.frontierComparison.classification,
        evidenceNote: model.frontierComparison.evidenceNote,
      },
    },
    memory,
    decodeTokensPerSecPerGpuUsed: tps,
    decodeThroughputSource: source,
    candidates,
    selected,
    assumptions,
  };
}
