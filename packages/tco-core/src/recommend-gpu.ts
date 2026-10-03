import type { OpenWeightModel } from "@tokenomics/pricing-data";
import {
  findCloudGpuInstance,
  findOpenWeightModel,
  getPricing,
  listCloudGpuInstances,
  type PricingBundle,
} from "./pricing-context.js";
import { inferenceCloudForScenario, resolveHyperscaler } from "./hyperscaler-resolve.js";
import { sizeGpuFleet, computeRequiredOutputTps } from "./gpu-sizing.js";
import type {
  GpuFleetSizing,
  GpuInstanceRecommendation,
  ScenarioInput,
  UsageTotals,
} from "./types.js";
import type { UsagePeriod } from "./types.js";

const VRAM_BY_GPU_MODEL: Record<string, number> = {
  L40S: 48,
  L4: 24,
  A10G: 24,
  H100: 80,
  Inferentia2: 16,
};

function vramPerGpu(instance: { gpuModel: string; vramGbPerGpu?: number }): number {
  return instance.vramGbPerGpu ?? VRAM_BY_GPU_MODEL[instance.gpuModel] ?? 24;
}

function modelMinVram(model: OpenWeightModel): number {
  if (model.minVramGbPerGpu !== undefined) return model.minVramGbPerGpu;
  if (model.quantization === "fp8") return 20;
  if (model.modelId.includes("70b") || model.modelId.includes("large")) return 40;
  if (model.modelId.includes("30b") || model.modelId.includes("mixtral")) return 22;
  return 16;
}

function modelAccelerator(model: OpenWeightModel): "nvidia" | "neuron" {
  if (model.preferredAccelerator) return model.preferredAccelerator;
  if (model.modelId.includes("neuron")) return "neuron";
  return "nvidia";
}

function generationTokensPerRequest(scenario: ScenarioInput): number {
  const w = scenario.workload;
  return w.avgOutputTokensPerRequest + (w.avgThinkingTokensPerRequest ?? 0);
}

function workloadForSizing(scenario: ScenarioInput) {
  const w = scenario.workload;
  const gen = generationTokensPerRequest(scenario);
  return {
    ...w,
    avgOutputTokensPerRequest: gen,
  };
}

export function computeGpusRequired(
  scenario: ScenarioInput,
  usage: UsageTotals,
  period: UsagePeriod,
  model: OpenWeightModel,
  gpusPerInstance: number
): GpuFleetSizing {
  return sizeGpuFleet(
    {
      workload: workloadForSizing(scenario),
      modelId: model.modelId,
      outputTokensPerSecPerGpu: model.outputTokensPerSecPerGpu,
      gpusPerInstance,
      sla: scenario.sla,
    },
    usage,
    period
  );
}

export function recommendGpuInstance(
  scenario: ScenarioInput,
  usage: UsageTotals,
  period: UsagePeriod
): GpuInstanceRecommendation | undefined {
  const ocp = scenario.openshift;
  if (!ocp?.selfHostedModelId) return undefined;
  if (ocp.inferenceFleet?.length || ocp.customStackHourlyUsd !== undefined) {
    return undefined;
  }

  const pricing = getPricing();
  const model = findOpenWeightModel(pricing, ocp.selfHostedModelId);
  if (!model) return undefined;

  const accel = modelAccelerator(model);
  const minVram = modelMinVram(model);
  const minGpus = model.minPhysicalGpus;

  const preliminary = computeGpusRequired(scenario, usage, period, model, 4);
  const gpusRequired = Math.max(minGpus, preliminary.gpusRequired);

  const gpuCloud = inferenceCloudForScenario(scenario);
  const candidates = listCloudGpuInstances(pricing, gpuCloud).filter((inst) => {
    const kind = inst.accelerator ?? "nvidia";
    if (accel === "neuron" && kind !== "neuron") return false;
    if (accel === "nvidia" && kind === "neuron") return false;
    if (vramPerGpu(inst) < minVram) return false;
    return true;
  });

  if (candidates.length === 0) {
    return {
      instanceId: ocp.gpuInstanceId,
      gpuNodes: preliminary.gpuNodes,
      physicalGpus: preliminary.physicalGpus,
      gpusRequired,
      hourlyUsd: 0,
      autoApplied: false,
      rationale: ["No catalog instance meets model VRAM/accelerator requirements."],
      userInstanceAdequate: false,
    };
  }

  const commitment = scenario.commitment;
  const key =
    commitment === "oneYear" ? "oneYear" : commitment === "threeYear" ? "threeYear" : "onDemand";

  let best: GpuInstanceRecommendation | undefined;

  for (const inst of candidates) {
    const nodesForCapacity = Math.ceil(gpusRequired / inst.gpus);
    const nodesForMin = Math.ceil(minGpus / inst.gpus);
    const gpuNodes = Math.max(nodesForCapacity, nodesForMin) + scenario.sla.haExtraNodes;
    const physicalGpus = gpuNodes * inst.gpus;
    const rate = inst.hourlyUsd[key] ?? inst.hourlyUsd.onDemand;
    const totalHourly = gpuNodes * rate;

    const rationale = [
      `${model.displayName}: ≥${minGpus} GPU(s), ≥${minVram}GB VRAM/GPU`,
      `Peak ~${computeRequiredOutputTps(
        scenario.workload.peakConcurrentRequests,
        generationTokensPerRequest(scenario),
        scenario.sla.maxLatencySeconds
      ).toFixed(0)} gen tok/s → ${gpusRequired} GPU(s) before HA`,
      `${gpuNodes}× ${inst.id} (${inst.gpus}× ${inst.gpuModel}, ${vramPerGpu(inst)}GB VRAM)`,
    ];

    const pick: GpuInstanceRecommendation = {
      instanceId: inst.id,
      gpuNodes,
      physicalGpus,
      gpusRequired,
      hourlyUsd: totalHourly,
      autoApplied: false,
      rationale,
      userInstanceAdequate: true,
    };

    if (!best || totalHourly < best.hourlyUsd) {
      best = pick;
    }
  }

  if (!best) return undefined;

  const userInst = findCloudGpuInstance(pricing, gpuCloud, ocp.gpuInstanceId);
  let userAdequate = false;
  if (userInst) {
    const uKind = userInst.accelerator ?? "nvidia";
    const accelOk = accel === "neuron" ? uKind === "neuron" : uKind !== "neuron";
    const vramOk = vramPerGpu(userInst) >= minVram;
    const userNodes =
      Math.max(
        Math.ceil(gpusRequired / userInst.gpus),
        Math.ceil(minGpus / userInst.gpus)
      ) + scenario.sla.haExtraNodes;
    const userPhysical = userNodes * userInst.gpus;
    userAdequate = accelOk && vramOk && userPhysical >= minGpus;
  }

  return { ...best, userInstanceAdequate: userAdequate };
}

export function applyGpuRecommendation(
  scenario: ScenarioInput,
  usage: UsageTotals,
  period: UsagePeriod
): { scenario: ScenarioInput; recommendation?: GpuInstanceRecommendation } {
  const ocp = scenario.openshift;
  if (!ocp) return { scenario };

  const auto = ocp.autoSelectGpuInstance !== false;
  const rec = recommendGpuInstance(scenario, usage, period);
  if (!rec) return { scenario, recommendation: undefined };

  if (!auto) {
    return {
      scenario,
      recommendation: { ...rec, autoApplied: false },
    };
  }

  const updated: ScenarioInput = {
    ...scenario,
    openshift: {
      ...ocp,
      gpuInstanceId: rec.instanceId,
      autoSelectGpuInstance: true,
    },
    aws:
      scenario.aws?.mode === "ec2"
        ? { ...scenario.aws, gpuInstanceId: rec.instanceId }
        : scenario.aws,
  };

  return {
    scenario: updated,
    recommendation: { ...rec, autoApplied: true },
  };
}

export function gpuSizingForScenario(
  scenario: ScenarioInput,
  usage: UsageTotals,
  period: UsagePeriod,
  pricing: PricingBundle
): GpuFleetSizing | undefined {
  const ocp = scenario.openshift;
  const h = resolveHyperscaler(scenario);
  const modelId =
    ocp?.selfHostedModelId ?? h?.selfHostedModelId ?? scenario.aws?.selfHostedModelId ?? "llama-3-8b";
  const model = findOpenWeightModel(pricing, modelId);
  const throughput = model ?? {
    modelId,
    displayName: modelId,
    quantization: "fp16",
    outputTokensPerSecPerGpu: 40,
    maxContextTokens: 8192,
    minPhysicalGpus: 1,
  };

  const gpuCloud = inferenceCloudForScenario(scenario);
  const instanceId =
    ocp?.gpuInstanceId ?? h?.gpuInstanceId ?? scenario.aws?.gpuInstanceId ?? "g6.2xlarge";
  const inst = findCloudGpuInstance(pricing, gpuCloud, instanceId);
  let sizing = computeGpusRequired(
    scenario,
    usage,
    period,
    throughput,
    inst?.gpus ?? 1
  );

  const fleet = ocp?.inferenceFleet;
  if (fleet?.length) {
    let physicalGpus = 0;
    let gpuNodes = 0;
    for (const row of fleet) {
      const fi = findCloudGpuInstance(pricing, gpuCloud, row.instanceId);
      const codingFi = pricing.coding?.gpuInfra.instances.find((i) => i.id === row.instanceId);
      const gpus = fi?.gpus ?? codingFi?.gpusPerInstance ?? 0;
      physicalGpus += row.count * gpus;
      gpuNodes += row.count;
    }
    sizing = { ...sizing, gpuNodes, physicalGpus, gpusRequired: physicalGpus };
  } else {
    const nodesForCapacity = Math.ceil(sizing.gpusRequired / (inst?.gpus ?? 1));
    const nodesForMin = Math.ceil(throughput.minPhysicalGpus / (inst?.gpus ?? 1));
    const gpuNodes = Math.max(nodesForCapacity, nodesForMin) + scenario.sla.haExtraNodes;
    sizing = {
      ...sizing,
      gpuNodes,
      physicalGpus: gpuNodes * (inst?.gpus ?? 1),
    };
  }

  return sizing;
}
