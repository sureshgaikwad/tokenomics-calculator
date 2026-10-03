import {
  buildCloudPricingMeta,
  buildOpenWeightModelMeta,
  defaultComparisonScenario,
  evaluateScenario,
  getModelQualityAsync,
  getOpenWeightModels,
  getPricingAsync,
  getWorkloadTemplate,
  scenarioFromPcaPhase,
  scenarioInputSchema,
  sensitivitySweep,
  summarizePcaPhases,
  type ScenarioInput,
} from "@tokenomics/tco-core";
import { NextResponse } from "next/server";

function pricingPayload(
  pricing: Awaited<ReturnType<typeof getPricingAsync>>,
  modelQuality?: Awaited<ReturnType<typeof getModelQualityAsync>>
) {
  const clouds = buildCloudPricingMeta(pricing);
  const openList = getOpenWeightModels(pricing);
  const coding = pricing.coding;
  return {
    clouds,
    openWeightModels: buildOpenWeightModelMeta(pricing, openList),
    codingCatalog: {
      presets: coding.workloads.presets,
      defaults: coding.workloads.defaults,
      models: coding.models.models.map((m) => ({
        modelId: m.modelId,
        modelName: m.modelName,
        modelFamily: m.modelFamily,
        weightMemoryGb: m.weightMemoryGb,
        weightMemoryIsAssumption: m.weightMemoryIsAssumption,
        maximumContext: m.maximumContext,
        recommendedContext: m.recommendedContext,
        minimumGpuCount: m.minimumGpuCount,
        recommendedGpuType: m.recommendedGpuType,
        tensorParallelRequirement: m.tensorParallelRequirement,
        estimatedDecodeThroughputTokPerSecPerGpu: m.estimatedDecodeThroughputTokPerSecPerGpu,
        throughputIsAssumption: m.throughputIsAssumption,
        frontierComparison: m.frontierComparison,
        openWeightBridgeId: m.openWeightBridgeId,
        benchmarkNotes: m.benchmarkNotes,
      })),
      frontierModels: coding.frontier.models.map((f) => ({
        id: f.id,
        displayName: f.displayName,
        provider: f.provider,
        role: f.role,
        cloudBindings: f.cloudBindings,
        priceIsAssumption: f.priceIsAssumption,
        notes: f.notes,
      })),
      gpuInstances: coding.gpuInfra.instances.map((i) => ({
        id: i.id,
        displayName: i.displayName,
        cloudProvider: i.cloudProvider,
        gpusPerInstance: i.gpusPerInstance,
        gpuId: i.gpuId,
        priceIsAssumption: i.priceIsAssumption,
        availabilityNotes: i.availabilityNotes,
      })),
    },
    modelQuality: modelQuality
      ? {
          equivalenceClasses: modelQuality.equivalenceClasses,
          provenance: modelQuality.provenance,
        }
      : undefined,
    pcaPhases: summarizePcaPhases(),
    pricingProvenance: pricing.provenance,
    /** @deprecated use clouds.aws.managedModels */
    bedrockModels: clouds.aws.managedModels,
    /** @deprecated use clouds.aws.gpuInstances */
    gpuInstances: clouds.aws.gpuInstances,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action as string | undefined;

    const pricing = await getPricingAsync();
    const modelQuality = await getModelQualityAsync();

    if (action === "pricing") {
      return NextResponse.json(pricingPayload(pricing, modelQuality));
    }

    if (action === "bootstrap") {
      const workload = getWorkloadTemplate("rag");
      const scenario = defaultComparisonScenario(workload, { name: "Scenario A" });
      const result = evaluateScenario(scenario, pricing, modelQuality);
      return NextResponse.json({
        ...pricingPayload(pricing, modelQuality),
        result,
      });
    }

    if (action === "pcaPhase") {
      const phaseId = body.phaseId as string;
      const scenario = scenarioFromPcaPhase(phaseId);
      const result = evaluateScenario(scenario, pricing, modelQuality);
      return NextResponse.json({ scenario, result });
    }

    if (action === "sensitivity") {
      const scenario = scenarioInputSchema.parse(body.scenario) as ScenarioInput;
      const parameter = body.parameter as "requestsPerDay" | "peakConcurrentRequests" | "utilizationTarget";
      const values = body.values as number[];
      const points = sensitivitySweep(scenario, parameter, values, pricing);
      return NextResponse.json({ points });
    }

    const scenario = scenarioInputSchema.parse(body) as ScenarioInput;
    const result = evaluateScenario(scenario, pricing, modelQuality);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
