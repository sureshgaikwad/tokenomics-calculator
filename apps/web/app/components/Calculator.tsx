"use client";

import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_GPU_INSTANCE,
  DEFAULT_MANAGED_MODEL,
  DEFAULT_REGION,
  MANAGED_AI_SERVICE,
  defaultComparisonScenario,
  defaultOpenShiftPlatform,
  defaultSla,
  getWorkloadTemplate,
  type CodingIntensity,
  type ComparisonResult,
  type CommitmentTerm,
  type HyperscalerCloud,
  type HyperscalerPathMode,
  type LicensingMode,
  type OpenShiftPlatform,
  type ScenarioInput,
  type WorkloadKind,
} from "@tokenomics/tco-core/browser";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

const ComparisonCharts = dynamic(
  () => import("./ComparisonCharts").then((m) => m.ComparisonCharts),
  {
    ssr: false,
    loading: () => (
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading charts…</p>
      </div>
    ),
  }
);

type ModelQualityHint = {
  qualityTier?: string;
  ollAverage?: number;
};

type CloudCatalog = {
  managedServiceName: string;
  regions: Array<{ id: string; name: string }>;
  managedModels: Array<{ id: string; displayName: string } & ModelQualityHint>;
  gpuInstances: Array<{ id: string; gpus: number; gpuModel: string }>;
};

type PricingMeta = {
  clouds?: Record<HyperscalerCloud, CloudCatalog>;
  bedrockModels?: Array<{ id: string; displayName: string }>;
  gpuInstances?: Array<{ id: string; gpus: number; gpuModel: string }>;
  openWeightModels: Array<{
    modelId: string;
    displayName: string;
    maxContextTokens: number;
    outputTokensPerSecPerGpu: number;
    minPhysicalGpus: number;
    notes?: string;
  } & ModelQualityHint>;
  modelQuality?: {
    provenance: { huggingFaceLeaderboard: boolean; leaderboardReposMatched: number; notes: string[] };
  };
  codingCatalog?: {
    presets: Array<{
      id: string;
      label: string;
      avgInputTokensPerRequest: number;
      avgOutputTokensPerRequest: number;
      requestsPerActiveDeveloperPerHour: number;
      targetOutputTokensPerSecPerUser: number;
      contextTokens: number;
      p95TtftSeconds: number;
    }>;
    defaults: {
      developers: number;
      peakActivePercentage: number;
      generationConcurrencyPercentage: number;
      activeHoursPerDay: number;
      kvCacheGbPerActiveSequence: number;
      runtimeOverheadFraction: number;
      safetyMarginFraction: number;
    };
    models: Array<{
      modelId: string;
      modelName: string;
      frontierComparison: {
        frontierModelId: string;
        classification: string;
        evidenceNote?: string;
      };
      estimatedDecodeThroughputTokPerSecPerGpu: number | null;
      throughputIsAssumption?: boolean;
      weightMemoryIsAssumption?: boolean;
      benchmarkNotes?: string;
    }>;
    frontierModels: Array<{ id: string; displayName: string; notes?: string }>;
    gpuInstances: Array<{ id: string; displayName: string; gpusPerInstance: number }>;
  };
  pcaPhases?: Array<{
    id: string;
    name: string;
    status: string;
    devCapacity: string;
    benchmark: {
      costPerHourUsd?: number;
      costPer1MOutputTokensUsdPeak?: number;
      costPer1MOutputTokensUsdSustained?: number;
      notes?: string;
    };
    fleet: Array<{ instanceId: string; count: number }>;
    modelId: string;
  }>;
};

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatModelLabel(
  displayName: string,
  hint?: ModelQualityHint
): string {
  const parts = [displayName];
  if (hint?.qualityTier) parts.push(hint.qualityTier);
  if (hint?.ollAverage !== undefined) parts.push(`OLL ${hint.ollAverage.toFixed(1)}`);
  return parts.length === 1 ? displayName : `${displayName} — ${parts.slice(1).join(" · ")}`;
}

function buildScenario(state: FormState): ScenarioInput {
  const workload = getWorkloadTemplate(state.workloadKind);
  workload.requestsPerDay = state.requestsPerDay;
  workload.peakConcurrentRequests = state.peakConcurrent;
  workload.avgInputTokensPerRequest = state.avgInputTokens;
  workload.avgOutputTokensPerRequest = state.avgOutputTokens;
  workload.activeHoursFraction = state.activeHoursFraction;
  workload.avgThinkingTokensPerRequest = state.avgThinkingTokens;
  workload.thinkingBlocksAsInputFraction = state.thinkingAsInputFraction;

  const sla = defaultSla();
  sla.utilizationTarget = state.utilizationTarget;
  sla.maxLatencySeconds = state.maxLatencySeconds;

  return defaultComparisonScenario(workload, {
    name: state.name,
    period: { unit: state.periodUnit, count: state.periodCount },
    commitment: state.commitment,
    sla,
    codingModelId: state.useDeveloperSizing ? state.codingModelId : undefined,
    developerPopulation: state.useDeveloperSizing
      ? {
          developers: state.developers,
          peakActivePercentage: state.peakActivePercentage,
          generationConcurrencyPercentage: state.generationConcurrencyPercentage,
          intensityPreset: state.intensityPreset,
          activeHoursPerDay: state.activeHoursPerDay,
          avgInputTokensPerRequest: state.avgInputTokens,
          avgOutputTokensPerRequest: state.avgOutputTokens,
          requestsPerActiveDeveloperPerHour: state.requestsPerActiveDeveloperPerHour,
          targetOutputTokensPerSecPerUser: state.targetOutputTokensPerSecPerUser,
          contextTokens: state.contextTokens,
          p95TtftSeconds: state.p95TtftSeconds,
          kvCacheGbPerActiveSequence: state.kvCacheGbPerActiveSequence,
          runtimeOverheadFraction: state.runtimeOverheadFraction,
          safetyMarginFraction: state.safetyMarginFraction,
          decodeTokensPerSecPerGpuOverride: state.decodeTokensPerSecPerGpuOverride || undefined,
        }
      : undefined,
    openshift: {
      platform: state.platform,
      licensingMode: state.licensingMode,
      useHcp: state.useHcp,
      gpuInstanceId: state.gpuInstanceId,
      selfHostedModelId: state.selfHostedModelId,
      region: state.openshiftRegion,
      workerCount: state.workerCount,
      customPrices: {
        openshiftAiMonthlyUsd: state.oaiMonthlyUsd,
        aiAcceleratorUsdPerGpuYear: state.acceleratorUsdPerGpuYear,
        vectorDbMonthlyUsd: state.vectorDbMonthlyUsd,
      },
      inferenceFleet: state.inferenceFleet,
      customStackHourlyUsd: state.customStackHourlyUsd,
      autoSelectGpuInstance: state.autoSelectGpu,
    },
    hyperscaler: {
      cloud: state.comparisonCloud,
      region: state.comparisonRegion,
      mode: state.hyperscalerMode,
      managedModelId: state.managedModelId,
      embeddingModelId: DEFAULT_EMBEDDING_MODEL[state.comparisonCloud],
      gpuInstanceId: state.gpuInstanceId,
      selfHostedModelId: state.selfHostedModelId,
    },
  });
}

function cloudCatalog(meta: PricingMeta | null, cloud: HyperscalerCloud): CloudCatalog {
  if (meta?.clouds?.[cloud]) return meta.clouds[cloud];
  return {
    managedServiceName: MANAGED_AI_SERVICE[cloud],
    regions: [{ id: DEFAULT_REGION[cloud], name: DEFAULT_REGION[cloud] }],
    managedModels: meta?.bedrockModels ?? [],
    gpuInstances: meta?.gpuInstances ?? [],
  };
}

interface FormState {
  name: string;
  workloadKind: WorkloadKind;
  requestsPerDay: number;
  peakConcurrent: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgThinkingTokens: number;
  thinkingAsInputFraction: number;
  activeHoursFraction: number;
  periodUnit: "month" | "year";
  periodCount: number;
  commitment: CommitmentTerm;
  platform: OpenShiftPlatform;
  licensingMode: LicensingMode;
  useHcp: boolean;
  comparisonCloud: HyperscalerCloud;
  comparisonRegion: string;
  openshiftRegion: string;
  hyperscalerMode: HyperscalerPathMode;
  managedModelId: string;
  gpuInstanceId: string;
  selfHostedModelId: string;
  workerCount: number;
  utilizationTarget: number;
  maxLatencySeconds: number;
  oaiMonthlyUsd: number;
  acceleratorUsdPerGpuYear: number;
  vectorDbMonthlyUsd: number;
  pcaPhaseId: string;
  inferenceFleet?: Array<{ instanceId: string; count: number }>;
  customStackHourlyUsd?: number;
  autoSelectGpu: boolean;
  useDeveloperSizing: boolean;
  developers: number;
  peakActivePercentage: number;
  generationConcurrencyPercentage: number;
  intensityPreset: CodingIntensity;
  activeHoursPerDay: number;
  requestsPerActiveDeveloperPerHour: number;
  targetOutputTokensPerSecPerUser: number;
  contextTokens: number;
  p95TtftSeconds: number;
  kvCacheGbPerActiveSequence: number;
  runtimeOverheadFraction: number;
  safetyMarginFraction: number;
  decodeTokensPerSecPerGpuOverride: number;
  codingModelId: string;
  showAdvancedCoding: boolean;
}

const initialForm: FormState = {
  name: "Scenario A",
  workloadKind: "rag",
  requestsPerDay: 5000,
  peakConcurrent: 10,
  avgInputTokens: 12000,
  avgOutputTokens: 800,
  avgThinkingTokens: 0,
  thinkingAsInputFraction: 0,
  activeHoursFraction: 0.4,
  periodUnit: "year",
  periodCount: 1,
  commitment: "oneYear",
  platform: "rosa",
  licensingMode: "managedCloudService",
  useHcp: true,
  comparisonCloud: "aws",
  comparisonRegion: DEFAULT_REGION.aws,
  openshiftRegion: DEFAULT_REGION.aws,
  hyperscalerMode: "managedApi",
  managedModelId: DEFAULT_MANAGED_MODEL.aws,
  gpuInstanceId: DEFAULT_GPU_INSTANCE.aws,
  selfHostedModelId: "llama-3-8b",
  workerCount: 6,
  utilizationTarget: 0.65,
  maxLatencySeconds: 30,
  oaiMonthlyUsd: 0,
  acceleratorUsdPerGpuYear: 0,
  vectorDbMonthlyUsd: 500,
  pcaPhaseId: "",
  autoSelectGpu: true,
  useDeveloperSizing: false,
  developers: 200,
  peakActivePercentage: 0.25,
  generationConcurrencyPercentage: 0.4,
  intensityPreset: "standard",
  activeHoursPerDay: 8,
  requestsPerActiveDeveloperPerHour: 15,
  targetOutputTokensPerSecPerUser: 30,
  contextTokens: 16000,
  p95TtftSeconds: 3,
  kvCacheGbPerActiveSequence: 1.5,
  runtimeOverheadFraction: 0.15,
  safetyMarginFraction: 0.2,
  decodeTokensPerSecPerGpuOverride: 0,
  codingModelId: "qwen3-coder-30b-a3b-fp8",
  showAdvancedCoding: false,
};

export function Calculator() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [meta, setMeta] = useState<PricingMeta | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [sensitivity, setSensitivity] = useState<
    Array<{ requestsPerDay: number; openshift: number; hyperscaler: number }>
  >([]);
  const activeCatalog = useMemo(
    () => cloudCatalog(meta, form.comparisonCloud),
    [meta, form.comparisonCloud]
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const applyPricingMeta = (data: Partial<PricingMeta>) => {
    setMeta({
      clouds: data.clouds,
      bedrockModels: data.bedrockModels ?? data.clouds?.aws?.managedModels ?? [],
      gpuInstances: data.gpuInstances ?? data.clouds?.aws?.gpuInstances ?? [],
      openWeightModels: data.openWeightModels ?? [],
      pcaPhases: data.pcaPhases,
      modelQuality: data.modelQuality,
      codingCatalog: data.codingCatalog,
    });
  };

  const setComparisonCloud = (cloud: HyperscalerCloud) => {
    const region = DEFAULT_REGION[cloud];
    setForm((f) => ({
      ...f,
      comparisonCloud: cloud,
      comparisonRegion: region,
      openshiftRegion: region,
      platform: defaultOpenShiftPlatform(cloud),
      managedModelId: DEFAULT_MANAGED_MODEL[cloud],
      gpuInstanceId: DEFAULT_GPU_INSTANCE[cloud],
      hyperscalerMode: "managedApi",
      useHcp: cloud === "aws",
    }));
  };

  const runSensitivity = useCallback(async (scenario: ScenarioInput) => {
    const values = [500, 2000, 5000, 15000, 50000, 100000];
    try {
      const sensRes = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sensitivity",
          scenario,
          parameter: "requestsPerDay",
          values,
        }),
      });
      const sensData = await sensRes.json();
      if (sensRes.ok && Array.isArray(sensData.points)) {
        setSensitivity(
          sensData.points.map(
            (p: {
              value: number;
              openshiftTotal: number;
              hyperscalerTotal?: number;
              awsTotal?: number;
            }) => ({
              requestsPerDay: p.value,
              openshift: p.openshiftTotal,
              hyperscaler: p.hyperscalerTotal ?? p.awsTotal ?? 0,
            })
          )
        );
      }
    } catch {
      setSensitivity([]);
    }
  }, []);

  const evaluate = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const scenario = buildScenario(form);
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenario),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Evaluation failed");
        setResult(null);
        return;
      }
      if (!data.openshift && !data.hyperscaler && !data.aws) {
        setError("Unexpected response from server");
        setResult(null);
        return;
      }
      const comparison = data as ComparisonResult;
      setResult({
        ...comparison,
        judges: comparison.judges ?? [],
      });
      if (comparison.gpuRecommendation?.autoApplied) {
        setForm((f) => ({
          ...f,
          gpuInstanceId: comparison.gpuRecommendation!.instanceId,
        }));
      }
      void runSensitivity(scenario);
    } catch {
      setError("Network error — is the dev server running?");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [form, runSensitivity]);

  useEffect(() => {
    setLoading(true);
    fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bootstrap" }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? "Failed to load calculator");
          return;
        }
        applyPricingMeta(data);
        const comparison = data.result as ComparisonResult;
        if (comparison?.openshift || comparison?.hyperscaler || comparison?.aws) {
          setResult({ ...comparison, judges: comparison.judges ?? [] });
        }
      })
      .catch(() => setError("Network error — is the dev server running?"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  const applyTemplate = (kind: WorkloadKind) => {
    const t = getWorkloadTemplate(kind);
    const useDevs = kind === "codeAssistant";
    const preset = meta?.codingCatalog?.presets.find((p) => p.id === "standard");
    setForm((f) => ({
      ...f,
      workloadKind: kind,
      requestsPerDay: t.requestsPerDay,
      peakConcurrent: t.peakConcurrentRequests,
      avgInputTokens: preset?.avgInputTokensPerRequest ?? t.avgInputTokensPerRequest,
      avgOutputTokens: preset?.avgOutputTokensPerRequest ?? t.avgOutputTokensPerRequest,
      avgThinkingTokens: t.avgThinkingTokensPerRequest ?? 0,
      thinkingAsInputFraction: t.thinkingBlocksAsInputFraction ?? 0,
      activeHoursFraction: t.activeHoursFraction,
      useDeveloperSizing: useDevs,
      intensityPreset: "standard",
      requestsPerActiveDeveloperPerHour: preset?.requestsPerActiveDeveloperPerHour ?? 15,
      targetOutputTokensPerSecPerUser: preset?.targetOutputTokensPerSecPerUser ?? 30,
      contextTokens: preset?.contextTokens ?? 16000,
      p95TtftSeconds: preset?.p95TtftSeconds ?? 3,
      selfHostedModelId: useDevs ? "qwen3-coder-30b-a3b-fp8" : f.selfHostedModelId,
      codingModelId: useDevs ? "qwen3-coder-30b-a3b-fp8" : f.codingModelId,
    }));
  };

  const applyIntensityPreset = (intensity: CodingIntensity) => {
    const preset = meta?.codingCatalog?.presets.find((p) => p.id === intensity);
    if (!preset) {
      update("intensityPreset", intensity);
      return;
    }
    setForm((f) => ({
      ...f,
      intensityPreset: intensity,
      avgInputTokens: preset.avgInputTokensPerRequest,
      avgOutputTokens: preset.avgOutputTokensPerRequest,
      requestsPerActiveDeveloperPerHour: preset.requestsPerActiveDeveloperPerHour,
      targetOutputTokensPerSecPerUser: preset.targetOutputTokensPerSecPerUser,
      contextTokens: preset.contextTokens,
      p95TtftSeconds: preset.p95TtftSeconds,
    }));
  };

  const derivedActiveDevelopers = form.developers * form.peakActivePercentage;
  const derivedConcurrent = Math.max(
    1,
    Math.ceil(derivedActiveDevelopers * form.generationConcurrencyPercentage)
  );
  const derivedRequiredTokPerSec =
    derivedConcurrent * form.targetOutputTokensPerSecPerUser;

  const hyperscalerBreakdown = result?.hyperscaler ?? result?.aws;

  const chartData = useMemo(() => {
    if (!result?.openshift || !hyperscalerBreakdown) return [];
    return [
      {
        name: "Fixed",
        OpenShift: result.openshift.fixedUsd,
        Hyperscaler: hyperscalerBreakdown.fixedUsd,
      },
      {
        name: "Variable",
        OpenShift: result.openshift.variableUsd,
        Hyperscaler: hyperscalerBreakdown.variableUsd,
      },
    ];
  }, [result, hyperscalerBreakdown]);

  const exportJson = () => {
    const scenario = buildScenario(form);
    const blob = new Blob([JSON.stringify({ scenario, result }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tco-scenario.json";
    a.click();
  };

  const exportCsv = () => {
    if (!result) return;
    const rows = [
      ["path", "category", "label", "amount_usd"],
      ...(result.openshift?.lineItems.map((i) => [
        "openshift",
        i.category,
        i.label,
        String(i.amountUsd),
      ]) ?? []),
      ...(hyperscalerBreakdown?.lineItems.map((i) => [
        form.comparisonCloud,
        i.category,
        i.label,
        String(i.amountUsd),
      ]) ?? []),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tco-breakdown.csv";
    a.click();
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key !== "pcaPhaseId" && f.pcaPhaseId
        ? { pcaPhaseId: "", inferenceFleet: undefined, customStackHourlyUsd: undefined }
        : {}),
    }));
  };

  const applyScenarioToForm = (scenario: ScenarioInput, phaseId: string) => {
    const w = scenario.workload;
    const o = scenario.openshift;
    setForm({
      ...initialForm,
      pcaPhaseId: phaseId,
      name: scenario.name,
      workloadKind: w.kind,
      requestsPerDay: w.requestsPerDay,
      peakConcurrent: w.peakConcurrentRequests,
      avgInputTokens: w.avgInputTokensPerRequest,
      avgOutputTokens: w.avgOutputTokensPerRequest,
      avgThinkingTokens: w.avgThinkingTokensPerRequest ?? 0,
      activeHoursFraction: w.activeHoursFraction,
      periodUnit: scenario.period.unit === "day" ? "month" : scenario.period.unit,
      periodCount: scenario.period.unit === "day" ? 1 : scenario.period.count,
      commitment: scenario.commitment,
      platform: o?.platform ?? "rosa",
      licensingMode: o?.licensingMode ?? "managedCloudService",
      useHcp: o?.useHcp ?? true,
      comparisonCloud: scenario.hyperscaler?.cloud ?? "aws",
      comparisonRegion: scenario.hyperscaler?.region ?? scenario.aws?.region ?? DEFAULT_REGION.aws,
      openshiftRegion: o?.region ?? DEFAULT_REGION.aws,
      gpuInstanceId: o?.gpuInstanceId ?? "g6e.2xlarge",
      selfHostedModelId: o?.selfHostedModelId ?? "qwen3-coder-30b-a3b-fp8",
      managedModelId:
        scenario.hyperscaler?.managedModelId ??
        scenario.aws?.bedrockModelId ??
        DEFAULT_MANAGED_MODEL.aws,
      hyperscalerMode:
        scenario.hyperscaler?.mode ??
        (scenario.aws?.mode === "ec2" ? "selfHostedGpu" : "managedApi"),
      workerCount: o?.workerCount ?? 6,
      utilizationTarget: scenario.sla.utilizationTarget,
      maxLatencySeconds: scenario.sla.maxLatencySeconds,
      inferenceFleet: o?.inferenceFleet,
      customStackHourlyUsd: o?.customStackHourlyUsd,
      autoSelectGpu: o?.autoSelectGpuInstance !== false && !o?.inferenceFleet?.length,
      oaiMonthlyUsd: o?.customPrices?.openshiftAiMonthlyUsd ?? 0,
      acceleratorUsdPerGpuYear: o?.customPrices?.aiAcceleratorUsdPerGpuYear ?? 0,
    });
  };

  const loadPcaPhase = async (phaseId: string) => {
    if (!phaseId) {
      setForm((f) => ({ ...f, pcaPhaseId: "", inferenceFleet: undefined, customStackHourlyUsd: undefined }));
      return;
    }
    setError(null);
    setLoading(true);
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pcaPhase", phaseId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load PCA phase");
      setLoading(false);
      return;
    }
    applyScenarioToForm(data.scenario as ScenarioInput, phaseId);
    const comparison = data.result as ComparisonResult;
    setResult({ ...comparison, judges: comparison.judges ?? [] });
    setLoading(false);
    setError(null);
  };

  return (
    <div className="grid">
      <aside className="panel">
        <h2>Comparison cloud</h2>
        <div className="field">
          <label>Hyperscaler</label>
          <select
            value={form.comparisonCloud}
            onChange={(e) => setComparisonCloud(e.target.value as HyperscalerCloud)}
          >
            <option value="aws">Amazon Web Services</option>
            <option value="azure">Microsoft Azure</option>
            <option value="gcp">Google Cloud</option>
          </select>
        </div>
        <div className="field">
          <label>Region ({activeCatalog.managedServiceName})</label>
          <select
            value={form.comparisonRegion}
            onChange={(e) => {
              const region = e.target.value;
              setForm((f) => ({
                ...f,
                comparisonRegion: region,
                openshiftRegion: region,
              }));
            }}
          >
            {activeCatalog.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 1rem" }}>
          Compare OpenShift AI vs <strong>{activeCatalog.managedServiceName}</strong> (managed API)
          or self-hosted GPUs on {form.comparisonCloud.toUpperCase()}. Catalog prices are
          region-specific where live refresh is enabled.
        </p>

        <h2>Use case</h2>
        <div className="field">
          <label>Private Code Assistant reference phase</label>
          <select
            value={form.pcaPhaseId}
            onChange={(e) => loadPcaPhase(e.target.value)}
          >
            <option value="">— Custom scenario —</option>
            {(meta?.pcaPhases ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {form.pcaPhaseId && meta?.pcaPhases && (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
              {(() => {
                const p = meta.pcaPhases.find((x) => x.id === form.pcaPhaseId);
                if (!p) return null;
                const b = p.benchmark;
                return `${p.devCapacity}. Stack ~$${b.costPerHourUsd ?? "?"}/hr · ref $/1M out (peak) ~$${b.costPer1MOutputTokensUsdPeak ?? "—"} (see ${"PCA README"}).`;
              })()}
            </p>
          )}
        </div>
        <div className="field">
          <label>Name</label>
          <input value={form.name} onChange={(e) => update("name", e.target.value)} />
        </div>
        <div className="field">
          <label>Workload template</label>
          <select
            value={form.workloadKind}
            onChange={(e) => applyTemplate(e.target.value as WorkloadKind)}
          >
            <option value="rag">RAG assistant</option>
            <option value="codeAssistant">AI code assistant (developer sizing)</option>
            <option value="agentic">Agentic (AIOps / troubleshooting)</option>
            <option value="maas">MaaS (shared inference API)</option>
            <option value="batch">Batch (stub)</option>
          </select>
        </div>

        {form.workloadKind === "codeAssistant" && (
          <>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={form.useDeveloperSizing}
                  onChange={(e) => update("useDeveloperSizing", e.target.checked)}
                />
                Size GPUs from developer population (not GPU × developers)
              </label>
            </div>
            {form.useDeveloperSizing && (
              <>
                <h2>Developer population</h2>
                <div className="row2">
                  <div className="field">
                    <label>Developers</label>
                    <input
                      type="number"
                      value={form.developers}
                      onChange={(e) => update("developers", +e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Peak active %</label>
                    <input
                      type="number"
                      step={1}
                      min={1}
                      max={100}
                      value={Math.round(form.peakActivePercentage * 100)}
                      onChange={(e) => update("peakActivePercentage", +e.target.value / 100)}
                    />
                  </div>
                </div>
                <div className="row2">
                  <div className="field">
                    <label>Simultaneous generation %</label>
                    <input
                      type="number"
                      step={1}
                      min={1}
                      max={100}
                      value={Math.round(form.generationConcurrencyPercentage * 100)}
                      onChange={(e) =>
                        update("generationConcurrencyPercentage", +e.target.value / 100)
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Intensity preset</label>
                    <select
                      value={form.intensityPreset}
                      onChange={(e) => applyIntensityPreset(e.target.value as CodingIntensity)}
                    >
                      <option value="light">Light</option>
                      <option value="standard">Standard</option>
                      <option value="heavy">Heavy</option>
                      <option value="agentic">Agentic</option>
                    </select>
                  </div>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
                  Active developers = {derivedActiveDevelopers.toFixed(1)} · Concurrent inference
                  requests = {derivedConcurrent} · Required decode ≈ {derivedRequiredTokPerSec}{" "}
                  tok/s. Planning assumptions — not guaranteed performance.
                </p>
                <div className="field">
                  <label>Coding model (open-weight catalog)</label>
                  <select
                    value={form.codingModelId}
                    onChange={(e) => {
                      update("codingModelId", e.target.value);
                      update("selfHostedModelId", e.target.value);
                    }}
                  >
                    {(meta?.codingCatalog?.models ?? []).map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.modelName}
                        {m.throughputIsAssumption ? " (throughput assumption)" : ""}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const m = meta?.codingCatalog?.models.find(
                      (x) => x.modelId === form.codingModelId
                    );
                    if (!m) return null;
                    const fr = meta?.codingCatalog?.frontierModels.find(
                      (f) => f.id === m.frontierComparison.frontierModelId
                    );
                    return (
                      <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
                        Comparable frontier: {fr?.displayName ?? m.frontierComparison.frontierModelId}{" "}
                        ({m.frontierComparison.classification.replace(/-/g, " ")}).{" "}
                        {m.frontierComparison.evidenceNote}
                      </p>
                    );
                  })()}
                </div>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.showAdvancedCoding}
                      onChange={(e) => update("showAdvancedCoding", e.target.checked)}
                    />
                    Advanced / calculation details
                  </label>
                </div>
                {form.showAdvancedCoding && (
                  <>
                    <div className="row2">
                      <div className="field">
                        <label>Req / active developer / hour</label>
                        <input
                          type="number"
                          value={form.requestsPerActiveDeveloperPerHour}
                          onChange={(e) =>
                            update("requestsPerActiveDeveloperPerHour", +e.target.value)
                          }
                        />
                      </div>
                      <div className="field">
                        <label>Target output tok/s / user</label>
                        <input
                          type="number"
                          value={form.targetOutputTokensPerSecPerUser}
                          onChange={(e) =>
                            update("targetOutputTokensPerSecPerUser", +e.target.value)
                          }
                        />
                      </div>
                    </div>
                    <div className="row2">
                      <div className="field">
                        <label>Context tokens</label>
                        <input
                          type="number"
                          value={form.contextTokens}
                          onChange={(e) => update("contextTokens", +e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label>P95 TTFT target (s)</label>
                        <input
                          type="number"
                          value={form.p95TtftSeconds}
                          onChange={(e) => update("p95TtftSeconds", +e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="row2">
                      <div className="field">
                        <label>KV-cache GB / active sequence</label>
                        <input
                          type="number"
                          step={0.1}
                          value={form.kvCacheGbPerActiveSequence}
                          onChange={(e) => update("kvCacheGbPerActiveSequence", +e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label>Decode tok/s/GPU override (0 = catalog)</label>
                        <input
                          type="number"
                          value={form.decodeTokensPerSecPerGpuOverride}
                          onChange={(e) =>
                            update("decodeTokensPerSecPerGpuOverride", +e.target.value)
                          }
                        />
                      </div>
                    </div>
                    <div className="row2">
                      <div className="field">
                        <label>Runtime overhead fraction</label>
                        <input
                          type="number"
                          step={0.01}
                          value={form.runtimeOverheadFraction}
                          onChange={(e) => update("runtimeOverheadFraction", +e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label>Safety margin fraction</label>
                        <input
                          type="number"
                          step={0.01}
                          value={form.safetyMarginFraction}
                          onChange={(e) => update("safetyMarginFraction", +e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        <div className="row2">
          <div className="field">
            <label>
              {form.workloadKind === "agentic"
                ? "LLM round-trips / day"
                : form.workloadKind === "maas"
                  ? "API calls / day (all tenants)"
                  : form.useDeveloperSizing
                    ? "Requests / day (derived)"
                    : "Requests / day"}
            </label>
            <input
              type="number"
              disabled={form.useDeveloperSizing}
              value={form.requestsPerDay}
              onChange={(e) => update("requestsPerDay", +e.target.value)}
            />
          </div>
          <div className="field">
            <label>
              {form.useDeveloperSizing ? "Peak concurrent (derived)" : "Peak concurrent"}
            </label>
            <input
              type="number"
              disabled={form.useDeveloperSizing}
              value={form.useDeveloperSizing ? derivedConcurrent : form.peakConcurrent}
              onChange={(e) => update("peakConcurrent", +e.target.value)}
            />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Avg input tokens</label>
            <input
              type="number"
              value={form.avgInputTokens}
              onChange={(e) => update("avgInputTokens", +e.target.value)}
            />
          </div>
          <div className="field">
            <label>Avg output tokens (visible)</label>
            <input
              type="number"
              value={form.avgOutputTokens}
              onChange={(e) => update("avgOutputTokens", +e.target.value)}
            />
          </div>
        </div>
        {form.workloadKind === "agentic" && (
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
            Agentic template: requests/day = LLM <strong>round-trips</strong> (workflows × steps).
            Each step includes tool context in <strong>input</strong> and reasoning in{" "}
            <strong>thinking</strong> (billed as Bedrock output).
          </p>
        )}
        {form.workloadKind === "maas" && (
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
            MaaS template: centralized <strong>Models as a Service</strong> (OpenShift AI model
            serving / vLLM gateway) for many apps. Size on <strong>peak concurrent</strong> API
            calls and total daily invocations; compare private implied $/1M tokens vs Bedrock at
            platform scale.
          </p>
        )}
        {form.hyperscalerMode === "managedApi" && (
          <div className="row2">
            <div className="field">
              <label>Avg thinking tokens / req (Bedrock bills as output)</label>
              <input
                type="number"
                value={form.avgThinkingTokens}
                onChange={(e) => update("avgThinkingTokens", +e.target.value)}
              />
            </div>
            <div className="field">
              <label>Prior thinking as input (0–1)</label>
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={form.thinkingAsInputFraction}
                onChange={(e) => update("thinkingAsInputFraction", +e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="field">
          <label>Period</label>
          <div className="row2">
            <select
              value={form.periodUnit}
              onChange={(e) => update("periodUnit", e.target.value as "month" | "year")}
            >
              <option value="month">Months</option>
              <option value="year">Years</option>
            </select>
            <input
              type="number"
              value={form.periodCount}
              onChange={(e) => update("periodCount", +e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label>Commitment</label>
          <select
            value={form.commitment}
            onChange={(e) => update("commitment", e.target.value as CommitmentTerm)}
          >
            <option value="onDemand">On demand</option>
            <option value="oneYear">1 year</option>
            <option value="threeYear">3 year</option>
            <option value="spot">Spot (GPU)</option>
          </select>
        </div>

        <h2>OpenShift</h2>
        <div className="field">
          <label>Platform</label>
          <select
            value={form.platform}
            onChange={(e) => update("platform", e.target.value as OpenShiftPlatform)}
          >
            <option value="rosa">ROSA</option>
            <option value="aro">ARO</option>
            <option value="osd">OSD</option>
          </select>
        </div>
        <div className="field">
          <label>Licensing</label>
          <select
            value={form.licensingMode}
            onChange={(e) => update("licensingMode", e.target.value as LicensingMode)}
          >
            <option value="managedCloudService">OAI managed (Marketplace)</option>
            <option value="selfManaged">OAI self-managed</option>
          </select>
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={form.useHcp}
              onChange={(e) => update("useHcp", e.target.checked)}
            />
            ROSA HCP cluster fee
          </label>
        </div>
        <div className="field">
          <label>Open-weight model (OpenShift AI / vLLM)</label>
          <select
            value={form.selfHostedModelId}
            onChange={(e) => update("selfHostedModelId", e.target.value)}
          >
            {(meta?.openWeightModels ?? [{ modelId: form.selfHostedModelId, displayName: form.selfHostedModelId, maxContextTokens: 0, outputTokensPerSecPerGpu: 0, minPhysicalGpus: 1 }]).map(
              (m) => (
                <option key={m.modelId} value={m.modelId}>
                  {formatModelLabel(m.displayName, m)}
                </option>
              )
            )}
          </select>
          {meta?.openWeightModels && (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
              {(() => {
                const m = meta.openWeightModels.find((x) => x.modelId === form.selfHostedModelId);
                if (!m) return null;
                const qual =
                  m.qualityTier || m.ollAverage !== undefined
                    ? ` · ${m.qualityTier ?? ""}${m.ollAverage !== undefined ? ` OLL ${m.ollAverage.toFixed(1)}` : ""}`
                    : "";
                return `~${m.outputTokensPerSecPerGpu} out tok/s/GPU · ${(m.maxContextTokens / 1000).toFixed(0)}k context · min ${m.minPhysicalGpus} GPU(s)${qual}. ${m.notes ?? ""}`;
              })()}
            </p>
          )}
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={form.autoSelectGpu}
              disabled={!!form.inferenceFleet?.length}
              onChange={(e) => update("autoSelectGpu", e.target.checked)}
            />
            Auto-select GPU instance (model + peak SLA)
          </label>
        </div>
        <div className="field">
          <label>GPU instance</label>
          <select
            value={form.gpuInstanceId}
            disabled={form.autoSelectGpu || !!form.inferenceFleet?.length}
            onChange={(e) => update("gpuInstanceId", e.target.value)}
          >
            {(activeCatalog.gpuInstances.length
              ? activeCatalog.gpuInstances
              : [{ id: form.gpuInstanceId, gpus: 4, gpuModel: "" }]
            ).map(
              (g) => (
                <option key={g.id} value={g.id}>
                  {g.id} ({g.gpus}× {g.gpuModel})
                </option>
              )
            )}
          </select>
          {result?.gpuRecommendation && (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
              Fleet: {result.gpuRecommendation.gpuNodes}× {result.gpuRecommendation.instanceId} (
              {result.gpuRecommendation.physicalGpus} accelerators)
            </p>
          )}
        </div>
        <div className="field">
          <label>OAI monthly ($, your quote)</label>
          <input
            type="number"
            value={form.oaiMonthlyUsd}
            onChange={(e) => update("oaiMonthlyUsd", +e.target.value)}
          />
        </div>
        <div className="field">
          <label>AI Accelerator $/GPU/year</label>
          <input
            type="number"
            value={form.acceleratorUsdPerGpuYear}
            onChange={(e) => update("acceleratorUsdPerGpuYear", +e.target.value)}
          />
        </div>

        <h2>{activeCatalog.managedServiceName} comparison</h2>
        <div className="field">
          <label>Path</label>
          <select
            value={form.hyperscalerMode}
            onChange={(e) => update("hyperscalerMode", e.target.value as HyperscalerPathMode)}
          >
            <option value="managedApi">Managed API ({activeCatalog.managedServiceName})</option>
            <option value="selfHostedGpu">Self-hosted GPU VMs</option>
          </select>
        </div>
        {form.hyperscalerMode === "selfHostedGpu" && (
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
            Self-hosted path uses the same open-weight model as OpenShift (
            <code>{form.selfHostedModelId}</code>) on {form.comparisonCloud.toUpperCase()} GPU
            SKUs.
          </p>
        )}
        {form.hyperscalerMode === "managedApi" && (
          <div className="field">
            <label>Model</label>
            <select
              value={form.managedModelId}
              onChange={(e) => update("managedModelId", e.target.value)}
            >
              {activeCatalog.managedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatModelLabel(m.displayName, m)}
                </option>
              ))}
            </select>
          </div>
        )}

        <h2>SLA / sizing</h2>
        <div className="row2">
          <div className="field">
            <label>Max latency (s)</label>
            <input
              type="number"
              value={form.maxLatencySeconds}
              onChange={(e) => update("maxLatencySeconds", +e.target.value)}
            />
          </div>
          <div className="field">
            <label>GPU util target</label>
            <input
              type="number"
              step={0.05}
              min={0.1}
              max={1}
              value={form.utilizationTarget}
              onChange={(e) => update("utilizationTarget", +e.target.value)}
            />
          </div>
        </div>

        <div className="actions">
          <button type="button" onClick={() => evaluate()}>
            Recalculate
          </button>
          <button type="button" className="secondary" onClick={exportJson}>
            Export JSON
          </button>
          <button type="button" className="secondary" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
      </aside>

      <main>
        {loading && result && (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
            Recalculating…
          </p>
        )}
        {loading && !result && (
          <div className="panel">
            <p style={{ color: "var(--muted)", margin: 0 }}>Calculating TCO…</p>
          </div>
        )}
        {!loading && !result && !error && (
          <div className="panel">
            <p style={{ color: "var(--muted)", margin: 0 }}>
              Click Recalculate to run the comparison.
            </p>
          </div>
        )}
        {result && (
          <>
            <div className="compare-cards">
              <div
                className={`panel ${result.cheaperPath === "openshift" ? "winner" : ""}`}
              >
                <h2>OpenShift AI</h2>
                <div className="card-total">{formatUsd(result.openshift?.totalUsd ?? 0)}</div>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                  Fixed {formatUsd(result.openshift?.fixedUsd ?? 0)} · Implied out{" "}
                  {result.openshift?.impliedUsdPer1MOutputTokens
                    ? formatUsd(result.openshift.impliedUsdPer1MOutputTokens)
                    : "—"}
                  /1M tok
                </p>
              </div>
              <div
                className={`panel ${
                  result.cheaperPath === "hyperscaler" || result.cheaperPath === "aws"
                    ? "winner"
                    : ""
                }`}
              >
                <h2>
                  {form.comparisonCloud.toUpperCase()}{" "}
                  {form.hyperscalerMode === "managedApi"
                    ? activeCatalog.managedServiceName
                    : "self-hosted GPU"}
                </h2>
                <div className="card-total">{formatUsd(hyperscalerBreakdown?.totalUsd ?? 0)}</div>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                  Variable {formatUsd(hyperscalerBreakdown?.variableUsd ?? 0)} ·{" "}
                  {result.deltaUsd !== undefined &&
                    `Δ ${formatUsd(Math.abs(result.deltaUsd))} (${
                      result.cheaperPath === "openshift" ? "OCP cheaper" : "cloud cheaper"
                    })`}
                </p>
              </div>
            </div>

            <ComparisonCharts
              fixedVariable={chartData}
              sensitivity={sensitivity}
              hyperscalerLabel={`${form.comparisonCloud.toUpperCase()}`}
            />

            {result.codingInfra && (
              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2>Developer → GPU sizing</h2>
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 0 }}>
                  {result.codingInfra.demand.formula.activeDevelopers} →{" "}
                  {result.codingInfra.demand.formula.concurrentRequests} →{" "}
                  {result.codingInfra.demand.formula.requiredOutputTokensPerSec}. Valid topology
                  requires <strong>both</strong> memory fit and decode throughput.
                </p>
                <table className="breakdown">
                  <thead>
                    <tr>
                      <th>Memory component</th>
                      <th>GB</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Model weights</td>
                      <td>{result.codingInfra.memory.weightMemoryGb.toFixed(1)}</td>
                    </tr>
                    <tr>
                      <td>KV cache ({result.codingInfra.memory.kvMode})</td>
                      <td>{result.codingInfra.memory.kvCacheMemoryGb.toFixed(1)}</td>
                    </tr>
                    <tr>
                      <td>Runtime overhead</td>
                      <td>{result.codingInfra.memory.runtimeOverheadGb.toFixed(1)}</td>
                    </tr>
                    <tr>
                      <td>Safety margin</td>
                      <td>{result.codingInfra.memory.safetyMarginGb.toFixed(1)}</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Required VRAM</strong>
                      </td>
                      <td>
                        <strong>{result.codingInfra.memory.requiredVramGb.toFixed(1)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ fontSize: "0.85rem" }}>
                  Open model: <code>{result.codingInfra.model.modelName}</code> · Frontier
                  comparison:{" "}
                  <code>{result.codingInfra.model.frontierComparison.frontierDisplayName}</code> (
                  {result.codingInfra.model.frontierComparison.classification.replace(/-/g, " ")})
                </p>
                {result.codingInfra.selected ? (
                  <p style={{ fontSize: "0.85rem" }}>
                    Selected topology: {result.codingInfra.selected.totalInstances}×{" "}
                    {result.codingInfra.selected.displayName} (
                    {result.codingInfra.selected.totalGpus} GPUs,{" "}
                    {result.codingInfra.selected.totalReplicas} replicas incl. HA) · ~
                    {formatUsd(result.codingInfra.selected.annualUsd)}/yr GPU infra
                    {result.codingInfra.selected.priceIsAssumption ? " (planning price)" : ""}
                  </p>
                ) : (
                  <p style={{ fontSize: "0.85rem", color: "var(--danger, #b91c1c)" }}>
                    No valid topology — check judges / set decode tok/s override.
                  </p>
                )}
                <details>
                  <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                    All topology candidates
                  </summary>
                  <table className="breakdown">
                    <thead>
                      <tr>
                        <th>Instance</th>
                        <th>Mem</th>
                        <th>Tput</th>
                        <th>GPUs</th>
                        <th>$/yr</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.codingInfra.candidates.map((c) => (
                        <tr key={c.instanceId}>
                          <td>{c.displayName}</td>
                          <td>{c.memoryOk ? "ok" : "fail"}</td>
                          <td>{c.throughputOk ? "ok" : "fail"}</td>
                          <td>{c.totalGpus}</td>
                          <td>{c.valid ? formatUsd(c.annualUsd) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            )}

            {result.modelQuality && (
              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2>Model quality (Hugging Face OLL)</h2>
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 0 }}>
                  Open LLM Leaderboard averages help compare managed API vs open-weight picks.
                  {meta?.modelQuality?.provenance.huggingFaceLeaderboard
                    ? ` Live scores matched ${meta.modelQuality.provenance.leaderboardReposMatched} HF repos.`
                    : " Showing catalog tiers; OLL refresh runs in background when PRICING_MODE is not static."}
                </p>
                <table className="breakdown">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Model</th>
                      <th>Tier</th>
                      <th>OLL avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.modelQuality.managed && (
                      <tr>
                        <td>Managed API</td>
                        <td>{result.modelQuality.managed.modelId}</td>
                        <td>{result.modelQuality.managed.equivalenceLabel}</td>
                        <td>
                          {result.modelQuality.managed.average !== undefined
                            ? result.modelQuality.managed.average.toFixed(1)
                            : "—"}
                        </td>
                      </tr>
                    )}
                    {result.modelQuality.selfHosted && (
                      <tr>
                        <td>OpenShift open-weight</td>
                        <td>{result.modelQuality.selfHosted.modelId}</td>
                        <td>{result.modelQuality.selfHosted.equivalenceLabel}</td>
                        <td>
                          {result.modelQuality.selfHosted.average !== undefined
                            ? result.modelQuality.selfHosted.average.toFixed(1)
                            : "—"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {!result.modelQuality.sameEquivalenceClass && (
                  <p style={{ fontSize: "0.85rem", marginBottom: 0 }}>
                    Tiers differ — see judges for suggested open-weight peers.
                  </p>
                )}
              </div>
            )}

            <div className="panel" style={{ marginBottom: "1rem" }}>
              <h2>Assumption judges</h2>
              {(result.judges ?? []).length === 0 && (
                <p style={{ color: "var(--muted)" }}>No warnings for this scenario.</p>
              )}
              {(result.judges ?? []).map((j, idx) => (
                <div key={`${j.id}-${idx}`} className={`judge ${j.severity}`}>
                  <strong>{j.severity}</strong>: {j.message}
                  {j.suggestion && (
                    <div style={{ color: "var(--muted)", marginTop: 4 }}>{j.suggestion}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="row2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <BreakdownTable title="OpenShift line items" items={result.openshift?.lineItems ?? []} />
              <BreakdownTable
                title={`${form.comparisonCloud.toUpperCase()} line items`}
                items={hyperscalerBreakdown?.lineItems ?? []}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function BreakdownTable({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; category: string; amountUsd: number; formula?: string }>;
}) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <table className="breakdown">
        <thead>
          <tr>
            <th>Item</th>
            <th>Type</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={`${idx}-${i.label}`}>
              <td title={i.formula}>{i.label}</td>
              <td>{i.category}</td>
              <td>{formatUsd(i.amountUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
