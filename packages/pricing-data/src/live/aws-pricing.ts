import {
  GetProductsCommand,
  PricingClient,
  type Filter,
  type GetProductsCommandOutput,
} from "@aws-sdk/client-pricing";
import { getCached, setCached, pricingCacheTtlMs } from "./cache.js";
import { awsPriceListLocation } from "./regions.js";

const PRICING_API_REGION = "us-east-1";

function parseOnDemandUsd(priceListJson: string): number | undefined {
  const product = JSON.parse(priceListJson) as {
    terms?: { OnDemand?: Record<string, { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string }; unit?: string }> }> };
  };
  const onDemand = product.terms?.OnDemand;
  if (!onDemand) return undefined;
  for (const term of Object.values(onDemand)) {
    for (const dim of Object.values(term.priceDimensions ?? {})) {
      const usd = dim.pricePerUnit?.USD;
      if (usd && dim.unit === "Hrs") return Number(usd);
    }
  }
  return undefined;
}

function parseTokenUsdPer1M(priceListJson: string): number | undefined {
  const product = JSON.parse(priceListJson) as {
    terms?: { OnDemand?: Record<string, { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string }; unit?: string }> }> };
  };
  const onDemand = product.terms?.OnDemand;
  if (!onDemand) return undefined;
  for (const term of Object.values(onDemand)) {
    for (const dim of Object.values(term.priceDimensions ?? {})) {
      const usd = dim.pricePerUnit?.USD;
      const unit = dim.unit ?? "";
      if (!usd || !unit.toLowerCase().includes("token")) continue;
      const n = Number(usd);
      if (unit === "1K tokens") return n * 1000;
      if (unit === "1M tokens") return n;
      return n * 1000;
    }
  }
  return undefined;
}

async function getProducts(
  serviceCode: string,
  filters: { Field: string; Value: string; Type?: string }[]
): Promise<string[]> {
  const client = new PricingClient({ region: PRICING_API_REGION });
  const items: string[] = [];
  let nextToken: string | undefined;
  do {
    const out: GetProductsCommandOutput = await client.send(
      new GetProductsCommand({
        ServiceCode: serviceCode,
        Filters: filters.map(
          (f): Filter => ({
            Type: (f.Type ?? "TERM_MATCH") as Filter["Type"],
            Field: f.Field,
            Value: f.Value,
          })
        ),
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    if (out.PriceList) items.push(...out.PriceList);
    nextToken = out.NextToken;
    if (items.length >= 5) break;
  } while (nextToken);
  return items;
}

export async function fetchEc2LinuxOnDemandHourly(
  instanceType: string,
  awsRegion: string
): Promise<number | undefined> {
  const cacheKey = `ec2:${awsRegion}:${instanceType}`;
  const hit = getCached<number>(cacheKey);
  if (hit !== undefined) return hit;

  const location = awsPriceListLocation(awsRegion);
  const priceList = await getProducts("AmazonEC2", [
    { Field: "instanceType", Value: instanceType },
    { Field: "location", Value: location },
    { Field: "operatingSystem", Value: "Linux" },
    { Field: "tenancy", Value: "Shared" },
    { Field: "preInstalledSw", Value: "NA" },
    { Field: "capacitystatus", Value: "Used" },
  ]);

  for (const json of priceList) {
    const hourly = parseOnDemandUsd(json);
    if (hourly !== undefined) {
      setCached(cacheKey, hourly, pricingCacheTtlMs());
      return hourly;
    }
  }
  return undefined;
}

export async function fetchBedrockTokenPricePer1M(
  awsRegion: string,
  provider: string,
  model: string,
  inferenceType: "Input tokens" | "Output tokens"
): Promise<number | undefined> {
  const cacheKey = `bedrock:${awsRegion}:${provider}:${model}:${inferenceType}`;
  const hit = getCached<number>(cacheKey);
  if (hit !== undefined) return hit;

  const location = awsPriceListLocation(awsRegion);
  const priceList = await getProducts("AmazonBedrock", [
    { Field: "location", Value: location },
    { Field: "provider", Value: provider },
    { Field: "model", Value: model },
    { Field: "inferenceType", Value: inferenceType },
  ]);

  for (const json of priceList) {
    const per1m = parseTokenUsdPer1M(json);
    if (per1m !== undefined) {
      setCached(cacheKey, per1m, pricingCacheTtlMs());
      return per1m;
    }
  }
  return undefined;
}

export interface BedrockLiveLookup {
  provider: string;
  model: string;
  modelAliases?: string[];
}

export async function resolveBedrockLivePrices(
  awsRegion: string,
  lookup: BedrockLiveLookup
): Promise<{ inputPricePer1M?: number; outputPricePer1M?: number }> {
  const models = [lookup.model, ...(lookup.modelAliases ?? [])];
  for (const model of models) {
    const [inputPricePer1M, outputPricePer1M] = await Promise.all([
      fetchBedrockTokenPricePer1M(awsRegion, lookup.provider, model, "Input tokens"),
      fetchBedrockTokenPricePer1M(awsRegion, lookup.provider, model, "Output tokens"),
    ]);
    if (inputPricePer1M !== undefined || outputPricePer1M !== undefined) {
      return { inputPricePer1M, outputPricePer1M };
    }
  }
  return {};
}
