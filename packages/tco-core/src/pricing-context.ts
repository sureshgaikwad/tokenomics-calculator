import {
  listOpenWeightModels,
  loadAllPricing,
  loadAllPricingLive,
  loadModelQualityCatalog,
  loadModelQualityLive,
  type BedrockModel,
  type Ec2GpuInstance,
  type ModelQualityBundle,
  type OpenWeightModel,
  type PricingBundleWithMeta,
  type PricingMode,
} from "@tokenomics/pricing-data";
import type { HyperscalerCloud } from "./types.js";

export {
  loadAllPricing,
  loadAllPricingLive,
  type PricingBundleWithMeta,
  type PricingProvenance,
} from "@tokenomics/pricing-data";

export type PricingBundle = ReturnType<typeof loadAllPricing>;

let cached: PricingBundle | null = null;
let cachedLive: PricingBundleWithMeta | null = null;
let catalogSnapshot: PricingBundleWithMeta | null = null;
let liveInflight: Promise<PricingBundleWithMeta> | null = null;
let pricingOverride: PricingBundle | null = null;

let cachedModelQuality: ModelQualityBundle | null = null;
let modelQualityInflight: Promise<ModelQualityBundle> | null = null;

function pricingMode(): PricingMode {
  const m = (process.env.PRICING_MODE ?? "auto").toLowerCase();
  if (m === "static" || m === "live" || m === "auto") return m;
  return "auto";
}

function buildCatalogSnapshot(note: string): PricingBundleWithMeta {
  const base = loadAllPricing();
  return {
    ...base,
    provenance: {
      mode: pricingMode(),
      fetchedAt: new Date().toISOString(),
      ec2: { live: [], catalog: base.ec2Gpu.instances.map((i) => i.id) },
      bedrock: { live: [], catalog: base.bedrock.models.map((m) => m.id) },
      azureVm: { live: false, catalog: true },
      rosa: "catalog-only",
      openshiftAi: "catalog-only",
      notes: [note],
    },
  };
}

/** Refresh live hyperscaler rates without blocking HTTP handlers. */
export function startBackgroundPricingRefresh(): void {
  if (pricingMode() === "static") return;
  if (cachedLive && cachedLive.provenance.ec2.live.length > 0) return;
  if (liveInflight) return;

  liveInflight = loadAllPricingLive()
    .then((bundle) => {
      cachedLive = bundle;
      catalogSnapshot = null;
      liveInflight = null;
      return bundle;
    })
    .catch((err) => {
      liveInflight = null;
      const fallback = buildCatalogSnapshot(
        `Live pricing failed: ${err instanceof Error ? err.message : String(err)} — using YAML catalog`
      );
      cachedLive = fallback;
      catalogSnapshot = null;
      return fallback;
    });
}

export function getPricing(): PricingBundle {
  if (pricingOverride) return pricingOverride;
  if (cachedLive) return cachedLive;
  if (catalogSnapshot) return catalogSnapshot;
  if (!cached) cached = loadAllPricing();
  return cached;
}

/** Use a specific bundle for one evaluation (e.g. live-fetched pricing). */
export function withPricing<T>(bundle: PricingBundle, fn: () => T): T {
  const prev = pricingOverride;
  pricingOverride = bundle;
  try {
    return fn();
  } finally {
    pricingOverride = prev;
  }
}

/**
 * Returns immediately with YAML catalog when live rates are still loading.
 * Live AWS/Azure overlay runs in the background (see startBackgroundPricingRefresh).
 */
export async function getPricingAsync(): Promise<PricingBundleWithMeta> {
  if (pricingOverride && "provenance" in pricingOverride) {
    return pricingOverride as PricingBundleWithMeta;
  }

  const mode = pricingMode();
  if (mode === "static") {
    if (!cachedLive) {
      cachedLive = buildCatalogSnapshot("PRICING_MODE=static — YAML catalog only");
    }
    return cachedLive;
  }

  if (cachedLive && cachedLive.provenance.ec2.live.length > 0) {
    return cachedLive;
  }

  if (!catalogSnapshot) {
    catalogSnapshot = buildCatalogSnapshot(
      "Catalog prices shown; refreshing EC2/Bedrock/Azure rates in background"
    );
  }

  startBackgroundPricingRefresh();
  return catalogSnapshot;
}

/** Wait for live hyperscaler overlay (used by tests or explicit refresh). */
export async function getPricingLive(): Promise<PricingBundleWithMeta> {
  if (pricingMode() === "static") return getPricingAsync();
  startBackgroundPricingRefresh();
  if (liveInflight) return liveInflight;
  if (cachedLive) return cachedLive;
  return loadAllPricingLive().then((b) => {
    cachedLive = b;
    return b;
  });
}

export function resetPricingCache(): void {
  cached = null;
  cachedLive = null;
  catalogSnapshot = null;
  liveInflight = null;
  cachedModelQuality = null;
  modelQualityInflight = null;
}

/** YAML quality tiers immediately; refreshes OLL scores from Hugging Face in background when not static. */
export async function getModelQualityAsync(): Promise<ModelQualityBundle> {
  if (cachedModelQuality?.provenance.huggingFaceLeaderboard) {
    return cachedModelQuality;
  }
  if (!cachedModelQuality) {
    cachedModelQuality = loadModelQualityCatalog();
  }
  if (pricingMode() === "static") {
    return cachedModelQuality;
  }
  if (!modelQualityInflight) {
    modelQualityInflight = loadModelQualityLive()
      .then((bundle) => {
        cachedModelQuality = bundle;
        modelQualityInflight = null;
        return bundle;
      })
      .catch(() => {
        modelQualityInflight = null;
        return cachedModelQuality!;
      });
  }
  return cachedModelQuality;
}

export function findGpuInstance(
  pricing: PricingBundle,
  instanceId: string
): Ec2GpuInstance | undefined {
  return pricing.ec2Gpu.instances.find((i) => i.id === instanceId);
}

export function findCloudGpuInstance(
  pricing: PricingBundle,
  cloud: HyperscalerCloud,
  instanceId: string
): Ec2GpuInstance | undefined {
  const catalog =
    cloud === "azure" ? pricing.azureGpu : cloud === "gcp" ? pricing.gcpGpu : pricing.ec2Gpu;
  return catalog.instances.find((i) => i.id === instanceId);
}

export function listCloudGpuInstances(pricing: PricingBundle, cloud: HyperscalerCloud) {
  const catalog =
    cloud === "azure" ? pricing.azureGpu : cloud === "gcp" ? pricing.gcpGpu : pricing.ec2Gpu;
  return catalog.instances;
}

export function findManagedModel(
  pricing: PricingBundle,
  cloud: HyperscalerCloud,
  modelId: string
) {
  if (!modelId) return undefined;
  if (cloud === "aws") return pricing.bedrock.models.find((m) => m.id === modelId);
  if (cloud === "azure") return pricing.azureOpenAi.models.find((m) => m.id === modelId);
  return pricing.gcpVertex.models.find((m) => m.id === modelId);
}

export function findEmbeddingPricePer1M(
  pricing: PricingBundle,
  cloud: HyperscalerCloud,
  embeddingModelId?: string
): number {
  const id = embeddingModelId ?? "";
  if (cloud === "aws") {
    const e = pricing.bedrock.embeddingModels.find((x) => x.id === id);
    return e?.inputPricePer1M ?? 0.02;
  }
  if (cloud === "azure") {
    return pricing.azureOpenAi.embeddingModels.find((x) => x.id === id)?.inputPricePer1M ?? 0.02;
  }
  return pricing.gcpVertex.embeddingModels.find((x) => x.id === id)?.inputPricePer1M ?? 0.025;
}

export function findBedrockModel(
  pricing: PricingBundle,
  modelId: string
): BedrockModel | undefined {
  return pricing.bedrock.models.find((m) => m.id === modelId);
}

export function getOpenWeightModels(pricing: PricingBundle): OpenWeightModel[] {
  const base = listOpenWeightModels(pricing.ec2Gpu);
  const byId = new Map(base.map((m) => [m.modelId, m]));

  // Merge coding catalog models so dropdowns stay data-driven and extensible.
  for (const cm of pricing.coding?.models.models ?? []) {
    if (byId.has(cm.modelId)) continue;
    const bridge = cm.openWeightBridgeId ? byId.get(cm.openWeightBridgeId) : undefined;
    byId.set(cm.modelId, {
      modelId: cm.modelId,
      displayName: cm.modelName,
      quantization: cm.precision,
      outputTokensPerSecPerGpu:
        cm.estimatedDecodeThroughputTokPerSecPerGpu ??
        bridge?.sustainedOutputTpsPerGpu ??
        bridge?.outputTokensPerSecPerGpu ??
        0,
      sustainedOutputTpsPerGpu: bridge?.sustainedOutputTpsPerGpu,
      maxContextTokens: cm.maximumContext,
      minPhysicalGpus: cm.minimumGpuCount,
      minVramGbPerGpu: cm.minimumGpuMemoryGb,
      preferredAccelerator: "nvidia",
      notes: cm.benchmarkNotes,
    });
  }

  return [...byId.values()];
}

export function findOpenWeightModel(
  pricing: PricingBundle,
  modelId: string
): OpenWeightModel | undefined {
  return getOpenWeightModels(pricing).find((m) => m.modelId === modelId);
}

export function getModelThroughput(
  pricing: PricingBundle,
  modelId: string
): {
  outputTokensPerSecPerGpu: number;
  maxContextTokens: number;
  minPhysicalGpus: number;
  displayName?: string;
} {
  const row = findOpenWeightModel(pricing, modelId);
  const legacy = pricing.ec2Gpu.modelThroughput.find((m) => m.modelId === modelId);
  const source = row ?? legacy;
  return {
    outputTokensPerSecPerGpu: source?.outputTokensPerSecPerGpu ?? 40,
    maxContextTokens: source?.maxContextTokens ?? 8192,
    minPhysicalGpus: row?.minPhysicalGpus ?? (modelId.includes("70b") ? 2 : 1),
    displayName: row?.displayName,
  };
}

export function hoursInPeriod(periodDays: number): number {
  return periodDays * 24;
}

export function commitmentHourlyKey(
  commitment: string
): "onDemand" | "oneYear" | "threeYear" | "spot" {
  if (commitment === "oneYear") return "oneYear";
  if (commitment === "threeYear") return "threeYear";
  if (commitment === "spot") return "spot";
  return "onDemand";
}
