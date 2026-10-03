import {
  loadModelQualityCatalog,
  managedCatalogKey,
  openWeightCatalogKey,
} from "@tokenomics/pricing-data";
import { MANAGED_AI_SERVICE } from "./cloud-presets.js";
import type { PricingBundle } from "./pricing-context.js";
import type { HyperscalerCloud } from "./types.js";

export type ManagedModelMeta = {
  id: string;
  displayName: string;
  qualityTier?: string;
  ollAverage?: number;
};

export type OpenWeightModelMeta = {
  modelId: string;
  displayName: string;
  maxContextTokens: number;
  outputTokensPerSecPerGpu: number;
  minPhysicalGpus: number;
  notes?: string;
  qualityTier?: string;
  ollAverage?: number;
};

export function buildCloudPricingMeta(pricing: PricingBundle) {
  const quality = loadModelQualityCatalog();

  const enrichManaged = (cloud: HyperscalerCloud, m: { id: string; displayName: string }) => {
    const q = quality.byCatalogKey[managedCatalogKey(cloud, m.id)];
    return {
      id: m.id,
      displayName: m.displayName,
      qualityTier: q?.equivalenceLabel,
      ollAverage: q?.scores.average,
    };
  };

  const clouds: Record<
    HyperscalerCloud,
    {
      managedServiceName: string;
      regions: Array<{ id: string; name: string }>;
      managedModels: ManagedModelMeta[];
      gpuInstances: Array<{ id: string; gpus: number; gpuModel: string }>;
    }
  > = {
    aws: {
      managedServiceName: MANAGED_AI_SERVICE.aws,
      regions: pricing.cloudRegions.aws,
      managedModels: pricing.bedrock.models
        .filter((m) => !m.isEmbedding)
        .map((m) => enrichManaged("aws", m)),
      gpuInstances: pricing.ec2Gpu.instances.map((g) => ({
        id: g.id,
        gpus: g.gpus,
        gpuModel: g.gpuModel,
      })),
    },
    azure: {
      managedServiceName: MANAGED_AI_SERVICE.azure,
      regions: pricing.cloudRegions.azure,
      managedModels: pricing.azureOpenAi.models.map((m) => enrichManaged("azure", m)),
      gpuInstances: pricing.azureGpu.instances.map((g) => ({
        id: g.id,
        gpus: g.gpus,
        gpuModel: g.gpuModel,
      })),
    },
    gcp: {
      managedServiceName: MANAGED_AI_SERVICE.gcp,
      regions: pricing.cloudRegions.gcp,
      managedModels: pricing.gcpVertex.models.map((m) => enrichManaged("gcp", m)),
      gpuInstances: pricing.gcpGpu.instances.map((g) => ({
        id: g.id,
        gpus: g.gpus,
        gpuModel: g.gpuModel,
      })),
    },
  };
  return clouds;
}

export function buildOpenWeightModelMeta(
  _pricing: PricingBundle,
  list: ReturnType<typeof import("./pricing-context.js").getOpenWeightModels>
): OpenWeightModelMeta[] {
  const quality = loadModelQualityCatalog();
  return list.map((m) => {
    const q = quality.byCatalogKey[openWeightCatalogKey(m.modelId)];
    return {
      modelId: m.modelId,
      displayName: m.displayName,
      maxContextTokens: m.maxContextTokens,
      outputTokensPerSecPerGpu: m.outputTokensPerSecPerGpu,
      minPhysicalGpus: m.minPhysicalGpus,
      notes: m.notes,
      qualityTier: q?.equivalenceLabel,
      ollAverage: q?.scores.average,
    };
  });
}
