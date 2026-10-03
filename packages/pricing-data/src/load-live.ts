import type { AroPricing, BedrockPricing, Ec2GpuPricing, RosaPricing } from "./index.js";
import { loadAllPricing } from "./index.js";
import { fetchEc2LinuxOnDemandHourly, resolveBedrockLivePrices } from "./live/aws-pricing.js";
import { fetchAzureVmHourly } from "./live/azure-retail.js";
import { getCached, setCached, pricingCacheTtlMs } from "./live/cache.js";

export type PricingMode = "static" | "live" | "auto";

export interface PricingProvenance {
  mode: PricingMode;
  fetchedAt: string;
  ec2: { live: string[]; catalog: string[] };
  bedrock: { live: string[]; catalog: string[] };
  azureVm: { live: boolean; catalog: boolean };
  rosa: "catalog-only";
  openshiftAi: "catalog-only";
  notes: string[];
}

export type PricingBundle = ReturnType<typeof loadAllPricing>;

export interface PricingBundleWithMeta extends PricingBundle {
  provenance: PricingProvenance;
}

function pricingMode(): PricingMode {
  const m = (process.env.PRICING_MODE ?? "auto").toLowerCase();
  if (m === "static" || m === "live" || m === "auto") return m;
  return "auto";
}

function scaleHourlyTiers(
  hourly: Record<string, number>,
  newOnDemand: number
): Record<string, number> {
  const oldOn = hourly.onDemand;
  if (!oldOn || oldOn <= 0) return { ...hourly, onDemand: newOnDemand };
  const scale = newOnDemand / oldOn;
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(hourly)) {
    next[k] = k === "onDemand" ? newOnDemand : v * scale;
  }
  return next;
}

async function applyLiveEc2(
  ec2: Ec2GpuPricing,
  region: string,
  provenance: PricingProvenance
): Promise<void> {
  await Promise.all(
    ec2.instances.map(async (inst) => {
      try {
        const live = await fetchEc2LinuxOnDemandHourly(inst.id, region);
        if (live === undefined) {
          provenance.ec2.catalog.push(inst.id);
          return;
        }
        inst.hourlyUsd = scaleHourlyTiers(inst.hourlyUsd, live);
        provenance.ec2.live.push(inst.id);
      } catch {
        provenance.ec2.catalog.push(inst.id);
        provenance.notes.push(`EC2 live fetch failed for ${inst.id}`);
      }
    })
  );
}

async function applyLiveBedrock(
  bedrock: BedrockPricing,
  region: string,
  provenance: PricingProvenance
): Promise<void> {
  type CatalogModel = BedrockPricing["models"][number] & {
    awsPriceList?: { provider: string; model: string; modelAliases?: string[] };
  };

  for (const model of bedrock.models as CatalogModel[]) {
    const lookup = model.awsPriceList;
    if (!lookup) {
      provenance.bedrock.catalog.push(model.id);
      continue;
    }
    try {
      const live = await resolveBedrockLivePrices(region, lookup);
      if (live.inputPricePer1M !== undefined) model.inputPricePer1M = live.inputPricePer1M;
      if (live.outputPricePer1M !== undefined) model.outputPricePer1M = live.outputPricePer1M;
      if (live.inputPricePer1M !== undefined || live.outputPricePer1M !== undefined) {
        provenance.bedrock.live.push(model.id);
      } else {
        provenance.bedrock.catalog.push(model.id);
      }
    } catch {
      provenance.bedrock.catalog.push(model.id);
      provenance.notes.push(`Bedrock live fetch failed for ${model.id}`);
    }
  }

  for (const embed of bedrock.embeddingModels) {
    const full = (bedrock.models as CatalogModel[]).find((m) => m.id === embed.id);
    if (full?.inputPricePer1M) embed.inputPricePer1M = full.inputPricePer1M;
  }
}

async function applyLiveRosaWorker(rosa: RosaPricing, provenance: PricingProvenance): Promise<void> {
  try {
    const live = await fetchEc2LinuxOnDemandHourly(
      rosa.defaultWorkerInstance.type,
      rosa.region
    );
    if (live !== undefined) {
      rosa.defaultWorkerInstance.hourlyInfraUsd = live;
      provenance.notes.push(`ROSA worker EC2 (${rosa.defaultWorkerInstance.type}) refreshed from AWS Price List`);
    }
  } catch {
    provenance.notes.push("ROSA worker EC2 live fetch failed; using catalog infra rate");
  }
  provenance.rosa = "catalog-only";
  provenance.notes.push(
    "ROSA/OpenShift per-vCPU and HCP fees are not in the AWS Price List API — still from catalog YAML"
  );
}

async function applyLiveAro(aro: AroPricing, provenance: PricingProvenance): Promise<void> {
  try {
    const sku = aro.defaultWorkerInstance.type;
    const live = await fetchAzureVmHourly(aro.region, sku);
    if (live !== undefined) {
      aro.defaultWorkerInstance.hourlyInfraUsd = live;
      provenance.azureVm.live = true;
      provenance.notes.push(`ARO worker VM (${sku}) refreshed from Azure Retail Prices API`);
    } else {
      provenance.azureVm.catalog = true;
    }
  } catch {
    provenance.azureVm.catalog = true;
    provenance.notes.push("Azure VM live fetch failed; using catalog ARO infra rate");
  }
}

export async function loadAllPricingLive(): Promise<PricingBundleWithMeta> {
  const cacheKey = "bundle:live";
  const cached = getCached<PricingBundleWithMeta>(cacheKey);
  if (cached) return cached;

  const mode = pricingMode();
  const base = loadAllPricing();
  const provenance: PricingProvenance = {
    mode,
    fetchedAt: new Date().toISOString(),
    ec2: { live: [], catalog: [] },
    bedrock: { live: [], catalog: [] },
    azureVm: { live: false, catalog: false },
    rosa: "catalog-only",
    openshiftAi: "catalog-only",
    notes: [],
  };

  if (mode === "static") {
    provenance.notes.push("PRICING_MODE=static — all rates from YAML catalog");
    const bundle: PricingBundleWithMeta = { ...base, provenance };
    setCached(cacheKey, bundle, pricingCacheTtlMs());
    return bundle;
  }

  const tryLive = mode === "live" || mode === "auto";
  if (tryLive) {
    await Promise.all([
      applyLiveEc2(base.ec2Gpu, base.ec2Gpu.region, provenance),
      applyLiveBedrock(base.bedrock, base.bedrock.region, provenance),
      applyLiveRosaWorker(base.rosa, provenance),
      applyLiveAro(base.aro, provenance),
    ]);
  }

  if (mode === "live" && provenance.ec2.live.length === 0 && provenance.bedrock.live.length === 0) {
    provenance.notes.push(
      "PRICING_MODE=live but no AWS live rates returned — check AWS credentials (pricing:GetProducts) and region"
    );
  }

  const bundle: PricingBundleWithMeta = { ...base, provenance };
  setCached(cacheKey, bundle, pricingCacheTtlMs());
  return bundle;
}
