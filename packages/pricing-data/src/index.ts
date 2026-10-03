import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadCodingCatalogs } from "./coding-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(__dirname, "..", "data");

function loadYaml<T>(relativePath: string): T {
  const fullPath = join(dataRoot, relativePath);
  const raw = readFileSync(fullPath, "utf8");
  return parse(raw) as T;
}

export interface RosaPricing {
  version: string;
  effectiveDate: string;
  source: string;
  region: string;
  currency: string;
  workerFeePer4VcpuHour: Record<string, number>;
  workerFeePer4VcpuYear: Record<string, number>;
  hcpClusterFeePerHour: number;
  defaultWorkerInstance: {
    type: string;
    vcpu: number;
    hourlyInfraUsd: number;
    rootVolumeGb: number;
    rootVolumeGbMonthUsd: number;
  };
  defaultWorkerCount: number;
}

export interface Ec2GpuInstance {
  id: string;
  gpus: number;
  gpuModel: string;
  accelerator?: "nvidia" | "neuron";
  vramGbPerGpu?: number;
  vcpu: number;
  memoryGb: number;
  hourlyUsd: Record<string, number>;
}

export interface Ec2GpuPricing {
  version: string;
  effectiveDate: string;
  source: string;
  region: string;
  currency: string;
  instances: Ec2GpuInstance[];
  modelThroughput: Array<{
    modelId: string;
    quantization: string;
    outputTokensPerSecPerGpu: number;
    maxContextTokens: number;
  }>;
  openWeightModels?: OpenWeightModel[];
}

export interface OpenWeightModel {
  modelId: string;
  displayName: string;
  quantization: string;
  outputTokensPerSecPerGpu: number;
  sustainedOutputTpsPerGpu?: number;
  maxContextTokens: number;
  minPhysicalGpus: number;
  minVramGbPerGpu?: number;
  preferredAccelerator?: "nvidia" | "neuron";
  notes?: string;
}

export interface PcaPhaseFleetNode {
  instanceId: string;
  count: number;
}

export interface PcaReferencePhase {
  id: string;
  name: string;
  status: string;
  devCapacity: string;
  benchmark: {
    costPerHourUsd?: number;
    peakOutputTps?: number;
    sustainedOutputTpsAt30Concurrent?: number;
    costPer1MOutputTokensUsdPeak?: number;
    costPer1MOutputTokensUsdSustained?: number;
    notes?: string;
  };
  fleet: PcaPhaseFleetNode[];
  openshift: {
    selfHostedModelId: string;
    useHcp: boolean;
    workerCount: number;
    customStackHourlyUsd?: number;
  };
  workload: {
    kind: string;
    requestsPerDay: number;
    peakConcurrentRequests: number;
    avgInputTokensPerRequest: number;
    avgOutputTokensPerRequest: number;
    avgThinkingTokensPerRequest?: number;
    activeHoursFraction: number;
  };
}

export interface PcaReferenceCatalog {
  version: string;
  source: string;
  model: string;
  description: string;
  phases: PcaReferencePhase[];
  bedrockComparisonDefaults: {
    bedrockModelId: string;
    embeddingModelId: string;
    region: string;
  };
}

export interface BedrockModel {
  id: string;
  displayName: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  cacheReadPricePer1M?: number;
  maxContextTokens: number;
  isEmbedding?: boolean;
  supportsExtendedThinking?: boolean;
  /** Maps catalog id → AWS Price List API (provider + model name). */
  awsPriceList?: {
    provider: string;
    model: string;
    modelAliases?: string[];
  };
}

export interface BedrockPricing {
  version: string;
  effectiveDate: string;
  source: string;
  region: string;
  currency: string;
  models: BedrockModel[];
  embeddingModels: Array<{ id: string; inputPricePer1M: number }>;
}

export interface AroPricing {
  version: string;
  effectiveDate: string;
  source: string;
  region: string;
  currency: string;
  openshiftPremiumPer4VcpuHour: number;
  defaultWorkerInstance: {
    type: string;
    vcpu: number;
    hourlyInfraUsd: number;
    osDiskGb: number;
    diskGbMonthUsd: number;
  };
  defaultWorkerCount: number;
  controlPlaneNodes: number;
  controlPlaneIncludedInLicense: boolean;
}

export interface OpenShiftAiPricing {
  version: string;
  effectiveDate: string;
  source: string;
  currency: string;
  licensingModes: Record<
    string,
    { description: string; monthlyUsdPerCluster?: number; openshiftAiUsdPerCorePairYear?: number; note: string }
  >;
  aiAccelerator: { usdPerGpuYear: number; note: string };
  osd: {
    workerFeePer4VcpuYear: Record<string, number>;
    billingModels: string[];
  };
  ragAuxDefaults: {
    vectorDbMonthlyUsd: number;
    objectStorageMonthlyUsd: number;
    egressMonthlyUsd: number;
  };
}

export function loadRosaPricing(): RosaPricing {
  return loadYaml<RosaPricing>("aws/rosa.yaml");
}

export function loadEc2GpuPricing(): Ec2GpuPricing {
  return loadYaml<Ec2GpuPricing>("aws/ec2-gpu.yaml");
}

export function loadBedrockPricing(): BedrockPricing {
  return loadYaml<BedrockPricing>("aws/bedrock-models.yaml");
}

export function loadAroPricing(): AroPricing {
  return loadYaml<AroPricing>("azure/aro.yaml");
}

export function loadOpenShiftAiPricing(): OpenShiftAiPricing {
  return loadYaml<OpenShiftAiPricing>("redhat/openshift-ai.yaml");
}

export interface ManagedAiModel {
  id: string;
  displayName: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  maxContextTokens: number;
  isEmbedding?: boolean;
  supportsExtendedThinking?: boolean;
  cacheReadPricePer1M?: number;
  awsPriceList?: BedrockModel["awsPriceList"];
}

export interface ManagedAiPricing {
  version: string;
  effectiveDate: string;
  source: string;
  region: string;
  currency: string;
  serviceName?: string;
  models: ManagedAiModel[];
  embeddingModels: Array<{ id: string; inputPricePer1M: number }>;
}

export interface CloudRegion {
  id: string;
  name: string;
}

export interface CloudRegionsCatalog {
  version: string;
  aws: CloudRegion[];
  azure: CloudRegion[];
  gcp: CloudRegion[];
}

export function loadAzureOpenAiPricing(): ManagedAiPricing {
  return loadYaml<ManagedAiPricing>("azure/openai-models.yaml");
}

export function loadGcpVertexPricing(): ManagedAiPricing {
  return loadYaml<ManagedAiPricing>("gcp/vertex-models.yaml");
}

export function loadAzureGpuPricing(): Ec2GpuPricing {
  return loadYaml<Ec2GpuPricing>("azure/vm-gpu.yaml");
}

export function loadGcpGpuPricing(): Ec2GpuPricing {
  return loadYaml<Ec2GpuPricing>("gcp/gce-gpu.yaml");
}

export function loadCloudRegions(): CloudRegionsCatalog {
  return loadYaml<CloudRegionsCatalog>("cloud-regions.yaml");
}

export function loadPcaReferencePhases(): PcaReferenceCatalog {
  return loadYaml<PcaReferenceCatalog>("reference/private-code-assistant-phases.yaml");
}

export function listOpenWeightModels(pricing: Ec2GpuPricing): OpenWeightModel[] {
  if (pricing.openWeightModels?.length) return pricing.openWeightModels;
  return pricing.modelThroughput.map((m) => ({
    modelId: m.modelId,
    displayName: m.modelId,
    quantization: m.quantization,
    outputTokensPerSecPerGpu: m.outputTokensPerSecPerGpu,
    maxContextTokens: m.maxContextTokens,
    minPhysicalGpus: m.modelId.includes("70b") || m.modelId.includes("large") ? 2 : 1,
  }));
}

export function loadAllPricing() {
  return {
    rosa: loadRosaPricing(),
    ec2Gpu: loadEc2GpuPricing(),
    bedrock: loadBedrockPricing(),
    aro: loadAroPricing(),
    openshiftAi: loadOpenShiftAiPricing(),
    azureOpenAi: loadAzureOpenAiPricing(),
    gcpVertex: loadGcpVertexPricing(),
    azureGpu: loadAzureGpuPricing(),
    gcpGpu: loadGcpGpuPricing(),
    cloudRegions: loadCloudRegions(),
    coding: loadCodingCatalogs(),
  };
}

export type { PricingProvenance, PricingBundleWithMeta, PricingMode } from "./load-live.js";
export { loadAllPricingLive } from "./load-live.js";
export type {
  ModelQualityBundle,
  ResolvedModelQualityEntry,
  EquivalenceClass,
  ModelQualityScores,
} from "./model-quality.js";
export {
  loadModelQualityCatalog,
  loadModelQualityLive,
  managedCatalogKey,
  openWeightCatalogKey,
} from "./model-quality.js";
export type {
  CodingCatalogBundle,
  CodingModel,
  CodingWorkloadPreset,
  CodingWorkloadDefaults,
  FrontierModel,
  CodingGpuInstance,
  CodingGpuType,
  FrontierClassification,
} from "./coding-catalog.js";
export {
  loadCodingCatalogs,
  loadCodingWorkloadCatalog,
  loadCodingModelCatalog,
  loadFrontierCatalog,
  loadCodingGpuInfra,
  findCodingModel,
  findFrontierModel,
  findCodingGpuInstance,
  findCodingGpuType,
  listCodingGpuTypes,
} from "./coding-catalog.js";
