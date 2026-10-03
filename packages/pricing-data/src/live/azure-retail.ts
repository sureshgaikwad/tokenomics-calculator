import { getCached, setCached, pricingCacheTtlMs } from "./cache.js";

interface AzureRetailItem {
  retailPrice: number;
  unitOfMeasure: string;
  armSkuName?: string;
  productName?: string;
  skuName?: string;
  armRegionName?: string;
}

interface AzureRetailResponse {
  Items: AzureRetailItem[];
  NextPageLink?: string;
}

/** Linux pay-as-you-go hourly (excludes Windows / Spot / Low Priority). */
export async function fetchAzureVmHourly(
  armRegionName: string,
  armSkuName: string
): Promise<number | undefined> {
  const cacheKey = `azure:vm:${armRegionName}:${armSkuName}`;
  const hit = getCached<number>(cacheKey);
  if (hit !== undefined) return hit;

  const filter = encodeURIComponent(
    `armRegionName eq '${armRegionName}' and armSkuName eq '${armSkuName}' and priceType eq 'Consumption'`
  );
  let url: string | undefined =
    `https://prices.azure.com/api/retail/prices?$filter=${filter}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = (await res.json()) as AzureRetailResponse;
    for (const item of data.Items ?? []) {
      const name = `${item.productName ?? ""} ${item.skuName ?? ""}`.toLowerCase();
      if (name.includes("windows")) continue;
      if (name.includes("spot")) continue;
      if (name.includes("low priority")) continue;
      if (item.unitOfMeasure === "1 Hour" && item.retailPrice > 0) {
        setCached(cacheKey, item.retailPrice, pricingCacheTtlMs());
        return item.retailPrice;
      }
    }
    url = data.NextPageLink ?? undefined;
  }
  return undefined;
}
