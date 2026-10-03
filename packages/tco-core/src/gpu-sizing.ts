import type { GpuFleetSizing, GpuSizingInput, UsageTotals } from "./types.js";
import { periodToDays } from "./usage.js";
import type { UsagePeriod } from "./types.js";

export function computeRequiredOutputTps(
  peakConcurrentRequests: number,
  avgOutputTokensPerRequest: number,
  maxLatencySeconds: number
): number {
  if (maxLatencySeconds <= 0) return Infinity;
  return (peakConcurrentRequests * avgOutputTokensPerRequest) / maxLatencySeconds;
}

export function sizeGpuFleet(
  input: GpuSizingInput,
  usage: UsageTotals,
  period: UsagePeriod
): GpuFleetSizing {
  const { workload, outputTokensPerSecPerGpu, gpusPerInstance, sla } = input;
  const genTokens =
    workload.avgOutputTokensPerRequest + (workload.avgThinkingTokensPerRequest ?? 0);
  const requiredOutputTps = computeRequiredOutputTps(
    workload.peakConcurrentRequests,
    genTokens,
    sla.maxLatencySeconds
  );

  const effectiveTpsPerGpu = outputTokensPerSecPerGpu * sla.utilizationTarget;
  const gpusRequired = Math.max(
    1,
    Math.ceil(requiredOutputTps / effectiveTpsPerGpu)
  );

  const nodesForGpus = Math.ceil(gpusRequired / gpusPerInstance);
  const gpuNodes = nodesForGpus + sla.haExtraNodes;
  const physicalGpus = gpuNodes * gpusPerInstance;

  const periodSeconds = periodToDays(period) * 86400 * workload.activeHoursFraction;
  const capacityOutputTokens = requiredOutputTps * periodSeconds;
  const impliedUtilization =
    usage.outputTokens > 0 && capacityOutputTokens > 0
      ? Math.min(1, usage.outputTokens / capacityOutputTokens)
      : 0;

  return {
    requiredOutputTps,
    gpusRequired,
    gpuNodes,
    physicalGpus,
    impliedUtilization,
    totalOutputTokensInPeriod: usage.outputTokens,
  };
}
