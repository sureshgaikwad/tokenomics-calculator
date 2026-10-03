# TCO calculator assumptions

This tool structures total cost of ownership; it is **not** an official price quote from Red Hat, AWS, or Microsoft.

## Cost layers

1. **Fixed (time-based)** — cluster fees, worker subscriptions, GPU instances sized for peak SLA, OpenShift AI and AI Accelerator subscriptions, vector DB and storage baselines.
2. **Variable (usage-based)** — primarily **AWS Bedrock** input/output (and embedding) token charges. Self-hosted paths treat inference cost as sunk in GPU hours unless you add internal chargeback.

Self-hosted OpenShift and EC2 results include **implied $/1M input and output tokens** so you can compare against API pricing at your actual utilization.

## OpenShift platforms

| Platform | License component | Infra component |
|----------|-------------------|-----------------|
| ROSA | Per 4 vCPU worker-hour/year ([AWS ROSA pricing](https://aws.amazon.com/rosa/pricing/)) | EC2 + EBS for workers; optional HCP **$0.25/hr** cluster fee |
| ARO | OpenShift premium **$0.171 / 4 vCPU-hour** on workers ([Azure ARO](https://azure.microsoft.com/pricing/details/openshift/)) | Azure VM + disks |
| OSD | Same per-4-vCPU-year tiers as ROSA in catalog | Standard (single bill) vs CCS (cloud passthrough) — CCS shows infra as separate line |

## Red Hat AI licensing

- **OpenShift AI**: managed Marketplace add-on (enter monthly $) or self-managed core-pair (enter $/core-pair/year).
- **AI Accelerator**: one subscription per **physical** GPU in the fleet ([subscription guide](https://www.redhat.com/en/resources/ai-subscription-guide-detail)).

## Agentic workloads (AIOps, troubleshooting agents)

Modeled as **many LLM round-trips per day**, not one chat message per incident:

- **requestsPerDay** = total agent **steps** (e.g. 120 incidents × 15 LLM calls ≈ **1,800**).
- **avg input** — logs, metrics, traces, runbook chunks, prior tool JSON (often **20k–80k** per step).
- **avg output** — short plans, commands, summaries (**~500–1.5k** per step).
- **avg thinking** — extended reasoning per step (**~8k–20k** on Bedrock-class APIs; bills as **output**).
- **thinkingBlocksAsInputFraction** — multi-turn threads where prior reasoning returns as **input** (default **0.35** in template).

OpenShift path: size GPUs on **peak concurrent investigations** and per-step latency; thinking does not add a separate license line but increases **generation time** (consider higher output+thinking in SLA sizing). Bedrock path: thinking-heavy agentic flows often **favor private inference** at moderate scale.

## MaaS (Models as a Service)

Shared **inference API** (OpenShift AI model serving / vLLM gateway) consumed by many internal apps:

- **requestsPerDay** — sum of API calls across all tenants (not per-app).
- **peak concurrent** — gateway p95 in-flight requests (drives GPU fleet for SLA).
- **avg input/output** — typical chat/completion payload per call (system prompt + user message); no RAG corpus embedding in the default template.
- **activeHoursFraction** — often high (**~0.9**) for 24/7 platforms.

Compare **implied $/1M tokens** on OpenShift vs Bedrock; at **50k+ calls/day** the judges surface a scale crossover reminder.

## Developer population sizing (AI code assistants)

For the **AI code assistant** workload, GPU capacity is sized from concurrent inference demand — **not** `developers × GPU_per_developer`:

`Developers → peak active % → simultaneous generation % → concurrent requests → required decode tok/s → memory (weights + KV + overhead + margin) → valid GPU topology (memory AND throughput) → HA replicas → TCO`

Defaults: 200 developers, 25% peak active, 40% generation concurrency → 20 concurrent requests. Intensity presets (Light / Standard / Heavy / Agentic) live in `packages/pricing-data/data/coding/workload-presets.yaml`.

Coding models, frontier comparison targets, and H100/H200/B200 instance catalogs are separate YAML files under `packages/pricing-data/data/coding/` so they can be updated independently. Throughput and some weight-memory fields are marked as **editable assumptions** when no project measurement exists — do not treat them as guaranteed benchmarks.

A topology is valid only if **both** memory fit and decode throughput are satisfied.

## Open-weight models on OpenShift

Self-hosted inference uses the **open-weight model** catalog in `packages/pricing-data/data/aws/ec2-gpu.yaml` (`openWeightModels`), merged with coding models from `coding/coding-models.yaml`. Each entry drives **GPU sizing** (tokens/s/GPU, context limit, minimum physical GPUs) and appears in the UI under OpenShift. Benchmarks are editable planning numbers—not guaranteed throughput.

## Auto GPU instance selection

When **auto-select** is enabled (default), the engine picks the **lowest-cost catalog instance** that satisfies:

- Model **accelerator** (NVIDIA vs Inferentia2) and **min VRAM/GPU**
- **Minimum physical GPUs** for the model (e.g. 70B, Neuron TP=8)
- **Peak generation throughput** (visible output + **thinking** tokens per request, peak concurrency, max latency)
- **N+1 HA** extra nodes from SLA

PCA reference phases with a fixed **inference fleet** disable auto-select. Manual instance override with auto-select off triggers an error judge if undersized.

## GPU sizing

Peak output tokens/sec:

`(peak_concurrent_requests × avg_output_tokens) / max_latency_seconds`

GPUs required:

`ceil(required_tps / (benchmark_tps_per_gpu × utilization_target))`

Nodes include optional **N+1** HA extra nodes from SLA settings.

## AWS Bedrock

Per-model **input** and **output** $/1M tokens from [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) (seed data in `packages/pricing-data/data/aws/bedrock-models.yaml`). Embeddings billed separately for RAG.

### Extended thinking (Claude on Bedrock)

Thinking tokens are **not a separate line item on the Bedrock price list**. They are metered as **output tokens** at the model’s output $/1M rate ([AWS blog](https://aws.amazon.com/blogs/aws/anthropics-claude-3-7-sonnet-the-first-hybrid-reasoning-model-is-now-available-in-amazon-bedrock/), [extended thinking docs](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html)):

- Billed output can exceed the visible answer (you pay for full internal reasoning, not summarized thinking shown in the API).
- Thinking blocks from a prior assistant turn can return on the next request as **input** tokens.
- TPM quota “burndown” multipliers (e.g. 5× on some Claude models) affect **limits**, not your dollar invoice—you are still billed for actual input + output token counts.

In the calculator, set **avg thinking tokens per request** separately from visible **avg output tokens**. Optional **thinking-as-input fraction** models multi-turn threads. Self-hosted OpenShift/EC2 paths do not auto-add thinking unless you reflect it in output throughput sizing.

## Model quality (Hugging Face Open LLM Leaderboard)

Managed API models and open-weight catalog entries are mapped in `packages/pricing-data/data/model-quality.yaml` to **equivalence tiers** (frontier, strong ~70B open, mid open, coding specialist, fast API). When `PRICING_MODE` is not `static`, the app refreshes **OLL** scores from the [open-llm-leaderboard/contents](https://huggingface.co/datasets/open-llm-leaderboard/contents) dataset (by Hugging Face repo id) and merges them into the UI and **model-quality** judges. Closed frontier APIs use static planning scores until a public HF eval exists. This is for **apples-to-apples TCO comparisons**, not a guarantee of production quality for your workload.

## Judges (automated challenges)

- Managed vs open-weight **quality tier** mismatch (with suggested open peers)
- GPU utilization &lt; 20% vs peak-sized fleet
- RAG input tokens vs model context limit
- ARO (Azure) compared to AWS Bedrock without cross-cloud egress priced
- Missing OAI or embedding model selection
- Missing AI Accelerator quote when GPUs &gt; 0

## Known limitations

- Token counts vary by tokenizer; use fudge factor (default 1.02).
- No FTE / operations labor.
- No enterprise discounts unless you edit price tables.
- Batch workload template is a stub for future spot/queue modeling.

## Example inputs (Bedrock token spend vs OpenShift)

OpenShift cost is mostly **fixed** (platform + GPU fleet sized for **peak** concurrency and latency). Bedrock scales **linearly** with tokens. Crossover happens when volume × (input + output + thinking) price exceeds that fixed stack.

Use a **single-GPU** shape (`g6.2xlarge` / `g5.2xlarge`) and **Llama 3 8B** on OpenShift unless you truly need 70B on multi-GPU nodes. Set **peak concurrent** to something realistic for the daily request count (e.g. 10—not 50—for ~5k–25k RAG requests/day).

| Goal | Suggested inputs | Typical winner |
|------|------------------|----------------|
| API cheaper | Code assistant, **200** req/day, peak **3**, **1 month**, Bedrock **Claude 3.5 Sonnet**, OCP `g6.2xlarge` + 8B | AWS Bedrock |
| OCP cheaper | RAG, **25,000** req/day, peak **10**, **12k** in / **800** out, **1 year**, same Bedrock model, OCP `g6.2xlarge` + 8B, ROSA **3** workers, **HCP off** | OpenShift |
| OCP cheaper (faster) | RAG crossover ~**20,000** req/day with peak **10** on `g5.12xlarge` + 70B (higher fixed OCP, same token line) | OpenShift above ~20k/day |

**Judge:** If peak concurrency is too high for your traffic, GPU fleet (and OpenShift) looks artificially expensive—tune **max latency** or peak before comparing to Bedrock.

## Updating prices

Edit YAML under `packages/pricing-data/data/` and set `effectiveDate` and `source`. Rebuild packages before deploying the web app.
