import type { CodingWorkloadDefaults, CodingWorkloadPreset } from "@tokenomics/pricing-data";

export type CodingIntensity = "light" | "standard" | "heavy" | "agentic";

export interface DeveloperPopulationInput {
  developers: number;
  /** 0–1, e.g. 0.25 = 25% peak active */
  peakActivePercentage: number;
  /** 0–1, e.g. 0.40 = 40% of active developers generating simultaneously */
  generationConcurrencyPercentage: number;
  intensityPreset?: CodingIntensity;
  /** Hours/day with AI coding traffic (for request volume). Default 8. */
  activeHoursPerDay?: number;
  /** Override preset token / rate assumptions */
  avgInputTokensPerRequest?: number;
  avgOutputTokensPerRequest?: number;
  requestsPerActiveDeveloperPerHour?: number;
  targetOutputTokensPerSecPerUser?: number;
  contextTokens?: number;
  p95TtftSeconds?: number;
  /** Editable KV-cache GB per concurrent active sequence when architecture calc unavailable */
  kvCacheGbPerActiveSequence?: number;
  runtimeOverheadFraction?: number;
  safetyMarginFraction?: number;
  /** Optional decode tok/s/GPU override when catalog value is missing */
  decodeTokensPerSecPerGpuOverride?: number;
}

export interface DeveloperDemandResult {
  developers: number;
  peakActivePercentage: number;
  generationConcurrencyPercentage: number;
  activeDevelopers: number;
  concurrentRequests: number;
  requestsPerDay: number;
  avgInputTokensPerRequest: number;
  avgOutputTokensPerRequest: number;
  requestsPerActiveDeveloperPerHour: number;
  targetOutputTokensPerSecPerUser: number;
  contextTokens: number;
  p95TtftSeconds: number;
  requiredOutputTokensPerSec: number;
  intensityPreset: CodingIntensity;
  activeHoursPerDay: number;
  kvCacheGbPerActiveSequence: number;
  runtimeOverheadFraction: number;
  safetyMarginFraction: number;
  formula: {
    activeDevelopers: string;
    concurrentRequests: string;
    requiredOutputTokensPerSec: string;
    requestsPerDay: string;
  };
}

function resolvePreset(
  intensity: CodingIntensity,
  presets: CodingWorkloadPreset[]
): CodingWorkloadPreset {
  return presets.find((p) => p.id === intensity) ?? presets.find((p) => p.id === "standard")!;
}

/**
 * Developers → active → concurrent requests → token demand.
 * Never sizes as developers × GPU_per_developer.
 */
export function computeDeveloperDemand(
  input: DeveloperPopulationInput,
  defaults: CodingWorkloadDefaults,
  presets: CodingWorkloadPreset[]
): DeveloperDemandResult {
  const intensity = input.intensityPreset ?? "standard";
  const preset = resolvePreset(intensity, presets);

  const developers = Math.max(1, Math.floor(input.developers));
  const peakActivePercentage = clamp01(
    input.peakActivePercentage ?? defaults.peakActivePercentage
  );
  const generationConcurrencyPercentage = clamp01(
    input.generationConcurrencyPercentage ?? defaults.generationConcurrencyPercentage
  );
  const activeHoursPerDay =
    input.activeHoursPerDay ?? defaults.activeHoursPerDay ?? 8;

  const activeDevelopers = developers * peakActivePercentage;
  const concurrentRequests = Math.max(
    1,
    Math.ceil(activeDevelopers * generationConcurrencyPercentage)
  );

  const avgInput =
    input.avgInputTokensPerRequest ?? preset.avgInputTokensPerRequest;
  const avgOutput =
    input.avgOutputTokensPerRequest ?? preset.avgOutputTokensPerRequest;
  const reqPerActiveHour =
    input.requestsPerActiveDeveloperPerHour ??
    preset.requestsPerActiveDeveloperPerHour;
  const targetTokPerSec =
    input.targetOutputTokensPerSecPerUser ?? preset.targetOutputTokensPerSecPerUser;
  const contextTokens = input.contextTokens ?? preset.contextTokens;
  const p95TtftSeconds = input.p95TtftSeconds ?? preset.p95TtftSeconds;

  const requestsPerDay = Math.ceil(
    activeDevelopers * reqPerActiveHour * activeHoursPerDay
  );
  const requiredOutputTokensPerSec = concurrentRequests * targetTokPerSec;

  return {
    developers,
    peakActivePercentage,
    generationConcurrencyPercentage,
    activeDevelopers,
    concurrentRequests,
    requestsPerDay,
    avgInputTokensPerRequest: avgInput,
    avgOutputTokensPerRequest: avgOutput,
    requestsPerActiveDeveloperPerHour: reqPerActiveHour,
    targetOutputTokensPerSecPerUser: targetTokPerSec,
    contextTokens,
    p95TtftSeconds,
    requiredOutputTokensPerSec,
    intensityPreset: intensity,
    activeHoursPerDay,
    kvCacheGbPerActiveSequence:
      input.kvCacheGbPerActiveSequence ?? defaults.kvCacheGbPerActiveSequence,
    runtimeOverheadFraction:
      input.runtimeOverheadFraction ?? defaults.runtimeOverheadFraction,
    safetyMarginFraction:
      input.safetyMarginFraction ?? defaults.safetyMarginFraction,
    formula: {
      activeDevelopers: `${developers} × ${(peakActivePercentage * 100).toFixed(0)}% = ${activeDevelopers.toFixed(1)}`,
      concurrentRequests: `ceil(${activeDevelopers.toFixed(1)} × ${(generationConcurrencyPercentage * 100).toFixed(0)}%) = ${concurrentRequests}`,
      requiredOutputTokensPerSec: `${concurrentRequests} × ${targetTokPerSec} = ${requiredOutputTokensPerSec}`,
      requestsPerDay: `ceil(${activeDevelopers.toFixed(1)} × ${reqPerActiveHour}/hr × ${activeHoursPerDay}h) = ${requestsPerDay}`,
    },
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
