import type {
  CommitmentTerm,
  GpuFleetSizing,
  LineItem,
  OpenShiftPlatform,
  ScenarioInput,
  TcoBreakdown,
  UsageTotals,
} from "./types.js";
import {
  commitmentHourlyKey,
  findCloudGpuInstance,
  getPricing,
  hoursInPeriod,
} from "./pricing-context.js";
import { inferenceCloudForScenario } from "./hyperscaler-resolve.js";

export interface OpenShiftTcoParams {
  scenario: ScenarioInput;
  usage: UsageTotals;
  gpuSizing: GpuFleetSizing;
}

function sumLineItems(items: LineItem[]): { total: number; fixed: number; variable: number } {
  let fixed = 0;
  let variable = 0;
  for (const item of items) {
    if (item.category === "fixed") fixed += item.amountUsd;
    else variable += item.amountUsd;
  }
  return { total: fixed + variable, fixed, variable };
}

function platformWorkerFees(
  platform: OpenShiftPlatform,
  workerCount: number,
  vcpuPerWorker: number,
  hours: number,
  commitment: CommitmentTerm
): LineItem[] {
  const pricing = getPricing();
  const items: LineItem[] = [];
  const vcpuTotal = workerCount * vcpuPerWorker;
  const unitsOf4 = vcpuTotal / 4;

  if (platform === "rosa" || platform === "osd") {
    const yearKey =
      commitment === "oneYear"
        ? "oneYear"
        : commitment === "threeYear"
          ? "threeYear"
          : "onDemand";
    const per4Year = platform === "rosa"
      ? pricing.rosa.workerFeePer4VcpuYear[yearKey]
      : pricing.openshiftAi.osd.workerFeePer4VcpuYear[yearKey];
    const annualFraction = hours / (365 * 24);
    const amount = unitsOf4 * per4Year * annualFraction;
    items.push({
      id: `${platform}-worker-license`,
      label: `${platform.toUpperCase()} worker OpenShift fee (${unitsOf4} × 4 vCPU units)`,
      category: "fixed",
      amountUsd: amount,
      formula: `unitsOf4 * per4VcpuYear * (hours/8760)`,
    });
  }

  if (platform === "aro") {
    const rate = pricing.aro.openshiftPremiumPer4VcpuHour;
    const amount = unitsOf4 * rate * hours;
    items.push({
      id: "aro-openshift-premium",
      label: "ARO OpenShift premium on workers",
      category: "fixed",
      amountUsd: amount,
      formula: "(vcpu/4) * 0.171 * hours",
    });
  }

  return items;
}

function workerInfraFees(
  platform: OpenShiftPlatform,
  workerCount: number,
  hours: number,
  commitment: CommitmentTerm
): LineItem[] {
  const pricing = getPricing();
  const items: LineItem[] = [];
  const key = commitmentHourlyKey(commitment);

  if (platform === "rosa") {
    const w = pricing.rosa.defaultWorkerInstance;
    const infraRate =
      key === "onDemand"
        ? w.hourlyInfraUsd
        : w.hourlyInfraUsd * (key === "oneYear" ? 0.7 : 0.5);
    const storageMonth = (w.rootVolumeGb * w.rootVolumeGbMonthUsd * workerCount * (hours / 730));
    items.push({
      id: "rosa-worker-ec2",
      label: "AWS EC2 worker infrastructure",
      category: "fixed",
      amountUsd: workerCount * infraRate * hours,
    });
    items.push({
      id: "rosa-worker-ebs",
      label: "EBS root volumes",
      category: "fixed",
      amountUsd: storageMonth,
    });
  }

  if (platform === "aro") {
    const w = pricing.aro.defaultWorkerInstance;
    const infraRate =
      key === "onDemand" ? w.hourlyInfraUsd : w.hourlyInfraUsd * (key === "oneYear" ? 0.72 : 0.55);
    items.push({
      id: "aro-worker-vm",
      label: "Azure VM worker infrastructure",
      category: "fixed",
      amountUsd: workerCount * infraRate * hours,
    });
  }

  if (platform === "osd") {
    const w = pricing.rosa.defaultWorkerInstance;
    items.push({
      id: "osd-worker-infra",
      label: "OSD worker cloud infrastructure (CCS / passthrough estimate)",
      category: "fixed",
      amountUsd: workerCount * w.hourlyInfraUsd * hours,
      notes: "Use Standard billing for single Red Hat invoice; CCS splits cloud charges.",
    });
  }

  return items;
}

export function computeOpenShiftTco(params: OpenShiftTcoParams): TcoBreakdown {
  const { scenario, usage, gpuSizing } = params;
  const ocp = scenario.openshift;
  if (!ocp) throw new Error("OpenShift config required");

  const pricing = getPricing();
  const hours = hoursInPeriod(usage.periodDays);
  const commitment = scenario.commitment;
  const gpuCloud = inferenceCloudForScenario(scenario);
  const gpuInstance = findCloudGpuInstance(pricing, gpuCloud, ocp.gpuInstanceId);
  if (!gpuInstance && ocp.customStackHourlyUsd === undefined) {
    // Coding GPU catalog instances (H200/B200) may only exist in coding/gpu-infra.yaml
    const codingInst = pricing.coding?.gpuInfra.instances.find((i) => i.id === ocp.gpuInstanceId);
    if (!codingInst) throw new Error(`Unknown GPU instance: ${ocp.gpuInstanceId}`);
  }

  const workerCount =
    ocp.workerCount ??
    (ocp.platform === "rosa"
      ? pricing.rosa.defaultWorkerCount
      : pricing.aro.defaultWorkerCount);
  const vcpuPerWorker =
    ocp.platform === "aro"
      ? pricing.aro.defaultWorkerInstance.vcpu
      : pricing.rosa.defaultWorkerInstance.vcpu;

  const lineItems: LineItem[] = [];

  lineItems.push(...platformWorkerFees(ocp.platform, workerCount, vcpuPerWorker, hours, commitment));
  lineItems.push(...workerInfraFees(ocp.platform, workerCount, hours, commitment));

  if (ocp.platform === "rosa" && ocp.useHcp) {
    lineItems.push({
      id: "rosa-hcp-fee",
      label: "ROSA HCP cluster fee",
      category: "fixed",
      amountUsd: pricing.rosa.hcpClusterFeePerHour * hours,
      formula: "0.25 * hours",
    });
  }

  const gpuKey = commitmentHourlyKey(commitment);
  if (ocp.customStackHourlyUsd !== undefined) {
    lineItems.push({
      id: "gpu-inference-stack",
      label: "Inference GPU stack (sized from concurrent demand)",
      category: "fixed",
      amountUsd: ocp.customStackHourlyUsd * hours,
      formula: "customStackHourlyUsd * hours",
      notes: `${gpuSizing.physicalGpus} accelerators · instance ${ocp.gpuInstanceId}`,
    });
  } else if (ocp.inferenceFleet?.length) {
    for (const row of ocp.inferenceFleet) {
      const inst = findCloudGpuInstance(pricing, gpuCloud, row.instanceId);
      if (!inst) continue;
      const rate = inst.hourlyUsd[gpuKey] ?? inst.hourlyUsd.onDemand;
      lineItems.push({
        id: `gpu-${row.instanceId}`,
        label: `Inference ${row.count}× ${row.instanceId} (${inst.gpuModel})`,
        category: "fixed",
        amountUsd: row.count * rate * hours,
      });
    }
  } else if (gpuInstance) {
    const gpuHourly =
      gpuInstance.hourlyUsd[gpuKey] ?? gpuInstance.hourlyUsd.onDemand;
    lineItems.push({
      id: "gpu-ec2",
      label: `GPU nodes (${gpuSizing.gpuNodes} × ${gpuInstance.id})`,
      category: "fixed",
      amountUsd: gpuSizing.gpuNodes * gpuHourly * hours,
      notes: `${gpuSizing.physicalGpus} physical GPUs`,
    });
  } else {
    const codingInst = pricing.coding?.gpuInfra.instances.find((i) => i.id === ocp.gpuInstanceId);
    const rate =
      codingInst?.instanceHourlyCost[gpuKey] ?? codingInst?.instanceHourlyCost.onDemand ?? 0;
    lineItems.push({
      id: "gpu-coding-catalog",
      label: `GPU nodes (${gpuSizing.gpuNodes} × ${ocp.gpuInstanceId})`,
      category: "fixed",
      amountUsd: gpuSizing.gpuNodes * rate * hours,
      notes: `${gpuSizing.physicalGpus} physical GPUs (coding GPU catalog)`,
    });
  }

  const oaiMonthly =
    ocp.customPrices?.openshiftAiMonthlyUsd ??
    pricing.openshiftAi.licensingModes[ocp.licensingMode]?.monthlyUsdPerCluster ??
    0;
  const months = usage.periodDays / 30;
  if (ocp.licensingMode === "managedCloudService") {
    lineItems.push({
      id: "openshift-ai-managed",
      label: "OpenShift AI managed cloud service",
      category: "fixed",
      amountUsd: oaiMonthly * months,
    });
  } else {
    const corePairs = workerCount * (vcpuPerWorker / 2);
    const perCoreYear =
      pricing.openshiftAi.licensingModes.selfManaged?.openshiftAiUsdPerCorePairYear ?? 0;
    lineItems.push({
      id: "openshift-ai-self-managed",
      label: "OpenShift AI (self-managed core-pairs estimate)",
      category: "fixed",
      amountUsd: corePairs * perCoreYear * (hours / 8760),
      notes: "Enter openshiftAiUsdPerCorePairYear in custom prices",
    });
  }

  const accelPerGpuYear =
    ocp.customPrices?.aiAcceleratorUsdPerGpuYear ??
    pricing.openshiftAi.aiAccelerator.usdPerGpuYear;
  lineItems.push({
    id: "rh-ai-accelerator",
    label: "Red Hat AI Accelerator subscriptions",
    category: "fixed",
    amountUsd: gpuSizing.physicalGpus * accelPerGpuYear * (hours / 8760),
    formula: "physicalGpus * usdPerGpuYear * fractionOfYear",
  });

  if (scenario.workload.kind === "rag" || scenario.workload.kind === "agentic") {
    const aux = pricing.openshiftAi.ragAuxDefaults;
    const vectorMonthly =
      ocp.customPrices?.vectorDbMonthlyUsd ?? aux.vectorDbMonthlyUsd;
    const vectorLabel =
      scenario.workload.kind === "agentic"
        ? "Vector / runbook index (monthly estimate)"
        : "Vector database (monthly estimate)";
    lineItems.push({
      id: "rag-vector-db",
      label: vectorLabel,
      category: "fixed",
      amountUsd: vectorMonthly * months,
    });
    lineItems.push({
      id: "rag-object-storage",
      label: "Object storage for corpus / models",
      category: "fixed",
      amountUsd: aux.objectStorageMonthlyUsd * months,
    });
    lineItems.push({
      id: "rag-egress",
      label: "Data egress estimate",
      category: "fixed",
      amountUsd: aux.egressMonthlyUsd * months,
    });
  }

  const { total, fixed, variable } = sumLineItems(lineItems);
  const impliedIn =
    usage.inputTokens > 0 ? (total / usage.inputTokens) * 1_000_000 : undefined;
  const impliedOut =
    usage.outputTokens > 0 ? (total / usage.outputTokens) * 1_000_000 : undefined;

  return {
    lineItems,
    totalUsd: total,
    fixedUsd: fixed,
    variableUsd: variable,
    impliedUsdPer1MInputTokens: impliedIn,
    impliedUsdPer1MOutputTokens: impliedOut,
  };
}
