# Live pricing from hyperscalers

By default the web app uses **`PRICING_MODE=auto`**: it loads the YAML catalog, then overlays rates from public/cloud APIs where possible.

## What is fetched at runtime

| Component | API | Auth required |
|-----------|-----|----------------|
| **AWS EC2 GPU + ROSA worker VM** | [AWS Price List API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html) (`pricing:GetProducts`, `AmazonEC2`) | Yes — default AWS credential chain (`AWS_ACCESS_KEY_ID` / `AWS_PROFILE` / instance role) |
| **Bedrock token $/1M** | Same API, `AmazonBedrock` | Yes |
| **Azure / GCP GPU & managed AI** | YAML catalogs in `packages/pricing-data/data/azure/` and `data/gcp/` (live overlay planned) | No |
| **ARO worker VM (e.g. D4s_v5)** | [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) | No |
| **ROSA per-vCPU / HCP**, **ARO OpenShift premium**, **OpenShift AI**, **AI Accelerator**, **RAG aux**, **GPU throughput** | Local YAML only | — |

Bedrock models map to Price List `provider` + `model` via `awsPriceList` in `packages/pricing-data/data/aws/bedrock-models.yaml`. If AWS has no matching SKU (deprecated model name), the catalog fallback price is kept.

## Environment variables

| Variable | Values | Default |
|----------|--------|---------|
| `PRICING_MODE` | `auto`, `live`, `static` | `auto` |
| `PRICING_CACHE_TTL_SECONDS` | Cache TTL for live bundle | `3600` |

- **`static`** — YAML only (used in unit tests).
- **`auto`** — try live EC2/Bedrock/Azure VM; keep catalog for anything that fails.
- **`live`** — same as auto; adds a note if no live rates were returned.

## IAM (AWS)

Minimal policy for the app server role or local profile:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["pricing:GetProducts"],
      "Resource": "*"
    }
  ]
}
```

The Pricing API endpoint is only in **`us-east-1`** / **`ap-south-1`**; the client uses `us-east-1` regardless of workload region.

## Provenance in the UI

`POST /api/evaluate` with `{ "action": "pricing" }` returns `pricingProvenance` (live vs catalog instance ids, fetch time, notes).

## Tests

```bash
PRICING_MODE=static npm test
```
