export type PeriodUnit = "day" | "month" | "year";
export type CommitmentTerm = "onDemand" | "oneYear" | "threeYear" | "spot";
export type OpenShiftPlatform = "rosa" | "aro" | "osd";
export type OsdBillingModel = "standard" | "ccs";
export type LicensingMode = "managedCloudService" | "selfManaged";
export type AwsPathMode = "bedrock" | "ec2";
export type HyperscalerCloud = "aws" | "azure" | "gcp";
export type HyperscalerPathMode = "managedApi" | "selfHostedGpu";
export type WorkloadKind = "rag" | "codeAssistant" | "batch" | "agentic" | "maas";
export type CodingIntensity = "light" | "standard" | "heavy" | "agentic";

/** Developer-driven sizing for coding assistants (not GPU_per_developer). */
export interface DeveloperPopulationInput {
  developers: number;
  peakActivePercentage: number;
  generationConcurrencyPercentage: number;
  intensityPreset?: CodingIntensity;
  activeHoursPerDay?: number;
  avgInputTokensPerRequest?: number;
  avgOutputTokensPerRequest?: number;
  requestsPerActiveDeveloperPerHour?: number;
  targetOutputTokensPerSecPerUser?: number;
  contextTokens?: number;
  p95TtftSeconds?: number;
  kvCacheGbPerActiveSequence?: number;
  runtimeOverheadFraction?: number;
  safetyMarginFraction?: number;
  decodeTokensPerSecPerGpuOverride?: number;
}

export interface HyperscalerConfig {
  cloud: HyperscalerCloud;
  region: string;
  mode: HyperscalerPathMode;
  managedModelId?: string;
  embeddingModelId?: string;
  gpuInstanceId?: string;
  selfHostedModelId?: string;
}

export interface WorkloadProfile {
  kind: WorkloadKind;
  requestsPerDay: number;
  avgInputTokensPerRequest: number;
  avgOutputTokensPerRequest: number;
  peakConcurrentRequests: number;
  /** Fraction of day with active traffic (0–1). 1 = 24/7 */
  activeHoursFraction: number;
  /** RAG: embedding tokens per LLM request (query + optional re-embed share) */
  embeddingTokensPerLlmRequest?: number;
  /** RAG: one-time or monthly corpus embedding tokens */
  monthlyCorpusEmbeddingTokens?: number;
  embeddingOnlyRequestFraction?: number;
  /**
   * Claude extended thinking / reasoning tokens per LLM request (billed as output on Bedrock).
   * Often not visible in the user-facing response; do not double-count in avgOutputTokens.
   */
  avgThinkingTokensPerRequest?: number;
  /**
   * Fraction of prior-turn thinking blocks that reappear as input on follow-up turns (0–1).
   */
  thinkingBlocksAsInputFraction?: number;
  /**
   * Agentic: optional label for workshops — LLM round-trips per workflow (incident/run).
   * When set with agentWorkflowsPerDay, requestsPerDay should equal their product.
   */
  agentWorkflowsPerDay?: number;
  llmCallsPerWorkflow?: number;
  /** MaaS: approximate apps/teams consuming the shared inference API */
  maasConsumerCount?: number;
}

export interface UsagePeriod {
  unit: PeriodUnit;
  count: number;
}

export interface UsageTotals {
  periodDays: number;
  llmRequests: number;
  inputTokens: number;
  outputTokens: number;
  /** Billed on Bedrock at output $/1M; excluded from visible response token estimates */
  thinkingTokens: number;
  /** Extra input from prior thinking blocks on multi-turn threads */
  thinkingAsInputTokens: number;
  embeddingTokens: number;
  inputOutputRatio: number;
}

export interface SlaConfig {
  maxLatencySeconds: number;
  utilizationTarget: number;
  haExtraNodes: number;
  tokenCountFudgeFactor: number;
}

export interface GpuSizingInput {
  workload: WorkloadProfile;
  modelId: string;
  outputTokensPerSecPerGpu: number;
  gpusPerInstance: number;
  sla: SlaConfig;
}

export interface GpuFleetSizing {
  requiredOutputTps: number;
  gpusRequired: number;
  gpuNodes: number;
  physicalGpus: number;
  impliedUtilization: number;
  totalOutputTokensInPeriod: number;
}

export interface LineItem {
  id: string;
  label: string;
  category: "fixed" | "variable";
  amountUsd: number;
  formula?: string;
  notes?: string;
}

export interface TcoBreakdown {
  lineItems: LineItem[];
  totalUsd: number;
  fixedUsd: number;
  variableUsd: number;
  impliedUsdPer1MInputTokens?: number;
  impliedUsdPer1MOutputTokens?: number;
}

export type JudgeSeverity = "info" | "warning" | "error";

export interface JudgeWarning {
  id: string;
  severity: JudgeSeverity;
  message: string;
  suggestion?: string;
}

export interface ScenarioInput {
  name: string;
  workload: WorkloadProfile;
  period: UsagePeriod;
  sla: SlaConfig;
  commitment: CommitmentTerm;
  /**
   * When set, concurrent requests and daily volume are derived from developer population
   * (Developers → active → concurrent inference).
   */
  developerPopulation?: DeveloperPopulationInput;
  /** Preferred coding catalog model id (see coding/coding-models.yaml). */
  codingModelId?: string;
  openshift?: {
    platform: OpenShiftPlatform;
    osdBilling?: OsdBillingModel;
    licensingMode: LicensingMode;
    workerCount?: number;
    useHcp: boolean;
    gpuInstanceId: string;
    selfHostedModelId: string;
    region: string;
    customPrices?: {
      openshiftAiMonthlyUsd?: number;
      aiAcceleratorUsdPerGpuYear?: number;
      vectorDbMonthlyUsd?: number;
    };
    /** Fixed inference fleet (e.g. PCA phases); overrides SLA-sized node count for GPU $ */
    inferenceFleet?: Array<{ instanceId: string; count: number }>;
    /** Override sum of fleet hourly $ (documented stack cost from benchmarks) */
    customStackHourlyUsd?: number;
    /** When true (default), pick smallest sufficient GPU instance from catalog */
    autoSelectGpuInstance?: boolean;
  };
  /** Primary comparison path (AWS, Azure, or GCP managed AI / self-hosted GPU). */
  hyperscaler?: HyperscalerConfig;
  /** @deprecated Use hyperscaler with cloud aws */
  aws?: {
    mode: AwsPathMode;
    bedrockModelId?: string;
    embeddingModelId?: string;
    gpuInstanceId?: string;
    selfHostedModelId?: string;
    region: string;
  };
}

export interface GpuInstanceRecommendation {
  instanceId: string;
  gpuNodes: number;
  physicalGpus: number;
  gpusRequired: number;
  hourlyUsd: number;
  autoApplied: boolean;
  rationale: string[];
  userInstanceAdequate: boolean;
}

export interface ModelQualityComparisonView {
  managed?: {
    modelId: string;
    equivalenceClass: string;
    equivalenceLabel: string;
    average?: number;
    mmluPro?: number;
    scoreSource?: string;
  };
  selfHosted?: {
    modelId: string;
    equivalenceClass: string;
    equivalenceLabel: string;
    average?: number;
    mmluPro?: number;
    scoreSource?: string;
  };
  sameEquivalenceClass: boolean;
  averageGap?: number;
  suggestedOpenModels?: string[];
}

export interface ComparisonResult {
  openshift?: TcoBreakdown;
  hyperscaler?: TcoBreakdown;
  hyperscalerCloud?: HyperscalerCloud;
  /** Set when hyperscaler.cloud is aws (backward compatibility). */
  aws?: TcoBreakdown;
  deltaUsd?: number;
  cheaperPath?: "openshift" | "hyperscaler" | "aws" | "tie";
  gpuRecommendation?: GpuInstanceRecommendation;
  modelQuality?: ModelQualityComparisonView;
  /** Developer→GPU sizing details when developerPopulation is used. */
  codingInfra?: import("./coding-gpu-sizing.js").CodingInfraSizingResult;
  judges: JudgeWarning[];
  breakEven?: {
    metric: string;
    currentValue: number;
    breakEvenValue: number;
    direction: "above" | "below";
  };
}
