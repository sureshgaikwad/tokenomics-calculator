# Tokenomics Calculator

OpenShift AI vs AWS Frontier **TCO calculator** — library core, versioned pricing data, and Next.js UI.

## Quick start

```bash
npm install
npm run build
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Packages

- `@tokenomics/pricing-data` — YAML catalogs + optional live overlay (AWS Price List, Azure Retail)
- `@tokenomics/tco-core` — usage, GPU sizing, judges, OpenShift/AWS TCO, comparison
- `@tokenomics/web` — scenario UI, charts, JSON/CSV export

See [docs/assumptions.md](docs/assumptions.md) for formulas and [docs/pricing-live.md](docs/pricing-live.md) for live pricing and AWS credentials.

Private code assistant (Qwen3-Coder-30B, L40S vs Inferentia phases): [docs/private-code-assistant-examples.md](docs/private-code-assistant-examples.md).
