import { findCodingModel, type OpenWeightModel } from "@tokenomics/pricing-data";
import { findOpenWeightModel, type PricingBundle } from "./pricing-context.js";
import { computeDeveloperDemand } from "./developer-demand.js";
import { sizeCodingInfrastructure, type CodingInfraSizingResult } from "./coding-gpu-sizing.js";
import type { ScenarioInput } from "./types.js";

/**
 * When developerPopulation is set, derive concurrent requests / request volume from
 * Developers → active → concurrent inference (not GPU_per_developer).
 */
export function applyDeveloperPopulation(
  scenario: ScenarioInput,
  pricing: PricingBundle
): { scenario: ScenarioInput; codingInfra?: CodingInfraSizingResult } {
  const pop = scenario.developerPopulation;
  if (!pop) return { scenario };

  const coding = pricing.coding;
  const demand = computeDeveloperDemand(pop, coding.workloads.defaults, coding.workloads.presets);

  const activeHoursFraction = Math.min(1, demand.activeHoursPerDay / 24);

  const next: ScenarioInput = {
    ...scenario,
    workload: {
      ...scenario.workload,
      kind: scenario.workload.kind === "rag" ? "codeAssistant" : scenario.workload.kind,
      requestsPerDay: demand.requestsPerDay,
      peakConcurrentRequests: demand.concurrentRequests,
      avgInputTokensPerRequest: demand.avgInputTokensPerRequest,
      avgOutputTokensPerRequest: demand.avgOutputTokensPerRequest,
      activeHoursFraction,
    },
    sla: {
      ...scenario.sla,
      // Generation budget: TTFT + output / target tok/s (planning)
      maxLatencySeconds: Math.max(
        scenario.sla.maxLatencySeconds,
        demand.p95TtftSeconds +
          demand.avgOutputTokensPerRequest /
            Math.max(1, demand.targetOutputTokensPerSecPerUser)
      ),
    },
  };

  const codingModelId =
    scenario.codingModelId ??
    scenario.openshift?.selfHostedModelId ??
    scenario.hyperscaler?.selfHostedModelId;

  if (!codingModelId) {
    return { scenario: next };
  }

  const model = findCodingModel(coding.models, codingModelId);
  if (!model) {
    return { scenario: next };
  }

  let openWeightBridge: OpenWeightModel | undefined;
  if (model.openWeightBridgeId) {
    openWeightBridge = findOpenWeightModel(pricing, model.openWeightBridgeId);
  }

  const codingInfra = sizeCodingInfrastructure({
    demand,
    model,
    catalog: coding,
    openWeightBridge,
    commitment: scenario.commitment,
    haExtraReplicas: scenario.sla.haExtraNodes,
    decodeTokensPerSecPerGpuOverride: pop.decodeTokensPerSecPerGpuOverride,
  });

  if (codingInfra.selected && next.openshift) {
    const sel = codingInfra.selected;
    next.openshift = {
      ...next.openshift,
      selfHostedModelId: model.openWeightBridgeId ?? codingModelId,
      gpuInstanceId: sel.instanceId,
      autoSelectGpuInstance: false,
      inferenceFleet: [{ instanceId: sel.instanceId, count: sel.totalInstances }],
      customStackHourlyUsd: sel.hourlyUsd,
    };
  }

  const frontier = coding.frontier.models.find(
    (m) => m.id === model.frontierComparison.frontierModelId
  );
  if (frontier && next.hyperscaler?.mode === "managedApi") {
    const bound = frontier.cloudBindings?.[next.hyperscaler.cloud];
    if (bound) {
      next.hyperscaler = { ...next.hyperscaler, managedModelId: bound };
    }
  }

  return { scenario: next, codingInfra };
}
