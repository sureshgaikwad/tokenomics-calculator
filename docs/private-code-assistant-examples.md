# Private Code Assistant (PCA) reference scenarios

Based on [Private Code Assistant — Cross-Phase Cost Comparison (Qwen3-Coder-30B, 2 instances)](https://github.com/manu-joy/Private_Code_Assistant#cross-phase-cost-comparison-qwen3-coder-30b-2-instances).

## What is being compared

| Path | What you pay for |
|------|------------------|
| **OpenShift (PCA)** | ROSA HCP + workers + **fixed inference fleet** (g6e L40S and/or Inferentia2) running **Qwen3-Coder-30B** via vLLM |
| **AWS Bedrock** | **Variable** $/1M input + output (+ thinking tokens) for a frontier model (default Claude 3.5 Sonnet in phases) |

PCA’s table compares **infrastructure $/hr** and **$/1M output tokens at peak throughput** on the accelerator. The calculator adds **ROSA/OAI** and your **request/token** assumptions to produce a full-period TCO.

## Cross-phase table (from PCA README)

| Configuration | Instances | Cost/hr | Est. peak out tok/s | $/1M out (peak) | Dev capacity |
|---------------|-----------|---------|---------------------|-----------------|--------------|
| 1× g6e.2xlarge (L40S, FP8) | 1 | $2.24 | 1,357 / 692 @ 30 conc. | ~$0.46 / ~$0.90 sustained | 10–15 |
| 2× g6e.2xlarge | 2 | $4.48 | ~2,714 / ~1,384 @ 30 conc. | ~$0.46 | 20–30 |
| 1× inf2.48xlarge (2× Qwen BF16) | 2 logical | $12.98 | ~308 | ~$11.69 | 8–10 |
| 2× inf2.24xlarge | 2 | $12.98 | ~308 | ~$11.69 | 8–10 |

Inferentia runs **BF16 only** (no FP8), **TP=8** per instance, shorter context (8k on inf2.24xlarge)—see PCA “Why BF16 Only on Inferentia2”.

## Calculator phases (data file)

Loaded from [`packages/pricing-data/data/reference/private-code-assistant-phases.yaml`](../packages/pricing-data/data/reference/private-code-assistant-phases.yaml). In the UI, pick **Private Code Assistant reference phase**.

| Phase ID | Use case |
|----------|----------|
| `pca-phase-1` | Single L40S pilot — ~10–15 devs, Roo Code/Continue, moderate daily prompts |
| `pca-phase-2` | Two L40S + llm-d — **~20–30 devs**, higher daily volume; **Bedrock token bill typically exceeds OpenShift** at ~4k+ req/day with PCA token profile |
| `pca-phase-3` | Heterogeneous 2× L40S + 1× inf2.24xlarge — overflow to Neuron; uses documented **$9.18/hr** stack override |
| `pca-phase-5-inf2-48xl` | Dual Qwen on one inf2.48xlarge — high $/1M out vs L40S |
| `pca-phase-5-dual-inf2-24xl` | Two inf2.24xlarge instances — same $/hr as inf2.48 dual in PCA table |

### Default token profile (code assistant on OpenShift)

Aligned with IDE agents (large prompts + tool loops + Qwen **thinking** billed like extra output on Bedrock):

- **~4k input** / **~1.5k visible output** / **~2.5k thinking** per request  
- **Active hours fraction ~0.45** (business-hours-heavy)  
- **Peak concurrent** tied to dev capacity (e.g. 12 for phase 1, 25 for phase 2)

Adjust **requests/day** to your org: crossover vs Bedrock Sonnet is typically **~2.5k–3k req/day** for phase 2 fleet at this token mix (run sensitivity in UI).

## Models & instances in catalog

- **Qwen3-Coder-30B-A3B FP8** (`qwen3-coder-30b-a3b-fp8`) on **`g6e.2xlarge`** (L40S)  
- **Qwen3-Coder-30B-A3B BF16** (`qwen3-coder-30b-a3b-bf16-neuron`) on **Inferentia2**  
- Instances: `g6e.2xlarge`, `inf2.24xlarge`, `inf2.48xlarge`

## When Bedrock is still cheaper

- **Pilot / low requests** (e.g. phase 1 at ~800 req/day): fixed ROSA + GPU dominates; API wins on **total $**.  
- This matches PCA’s point: private inference wins at **sustained** enterprise usage, not every pilot.

## Link

- Repository: https://github.com/manu-joy/Private_Code_Assistant
