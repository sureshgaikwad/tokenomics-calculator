import { z } from "zod";

export const workloadProfileSchema = z.object({
  kind: z.enum(["rag", "codeAssistant", "batch", "agentic", "maas"]),
  requestsPerDay: z.number().positive(),
  avgInputTokensPerRequest: z.number().nonnegative(),
  avgOutputTokensPerRequest: z.number().nonnegative(),
  peakConcurrentRequests: z.number().positive(),
  activeHoursFraction: z.number().min(0).max(1),
  embeddingTokensPerLlmRequest: z.number().nonnegative().optional(),
  monthlyCorpusEmbeddingTokens: z.number().nonnegative().optional(),
  embeddingOnlyRequestFraction: z.number().min(0).max(1).optional(),
  avgThinkingTokensPerRequest: z.number().nonnegative().optional(),
  thinkingBlocksAsInputFraction: z.number().min(0).max(1).optional(),
  agentWorkflowsPerDay: z.number().positive().optional(),
  llmCallsPerWorkflow: z.number().positive().optional(),
});

export const usagePeriodSchema = z.object({
  unit: z.enum(["day", "month", "year"]),
  count: z.number().positive(),
});

export const slaConfigSchema = z.object({
  maxLatencySeconds: z.number().positive(),
  utilizationTarget: z.number().min(0.1).max(1),
  haExtraNodes: z.number().nonnegative(),
  tokenCountFudgeFactor: z.number().min(1).max(1.2).default(1),
});

export const developerPopulationSchema = z.object({
  developers: z.number().positive(),
  peakActivePercentage: z.number().min(0).max(1),
  generationConcurrencyPercentage: z.number().min(0).max(1),
  intensityPreset: z.enum(["light", "standard", "heavy", "agentic"]).optional(),
  activeHoursPerDay: z.number().positive().max(24).optional(),
  avgInputTokensPerRequest: z.number().nonnegative().optional(),
  avgOutputTokensPerRequest: z.number().nonnegative().optional(),
  requestsPerActiveDeveloperPerHour: z.number().positive().optional(),
  targetOutputTokensPerSecPerUser: z.number().positive().optional(),
  contextTokens: z.number().positive().optional(),
  p95TtftSeconds: z.number().positive().optional(),
  kvCacheGbPerActiveSequence: z.number().nonnegative().optional(),
  runtimeOverheadFraction: z.number().min(0).max(1).optional(),
  safetyMarginFraction: z.number().min(0).max(1).optional(),
  decodeTokensPerSecPerGpuOverride: z.number().positive().optional(),
});

export const scenarioInputSchema = z.object({
  name: z.string(),
  workload: workloadProfileSchema,
  period: usagePeriodSchema,
  sla: slaConfigSchema,
  commitment: z.enum(["onDemand", "oneYear", "threeYear", "spot"]),
  developerPopulation: developerPopulationSchema.optional(),
  codingModelId: z.string().optional(),
  openshift: z
    .object({
      platform: z.enum(["rosa", "aro", "osd"]),
      osdBilling: z.enum(["standard", "ccs"]).optional(),
      licensingMode: z.enum(["managedCloudService", "selfManaged"]),
      workerCount: z.number().positive().optional(),
      useHcp: z.boolean(),
      gpuInstanceId: z.string(),
      selfHostedModelId: z.string(),
      region: z.string(),
      customPrices: z
        .object({
          openshiftAiMonthlyUsd: z.number().nonnegative().optional(),
          aiAcceleratorUsdPerGpuYear: z.number().nonnegative().optional(),
          vectorDbMonthlyUsd: z.number().nonnegative().optional(),
        })
        .optional(),
      inferenceFleet: z
        .array(z.object({ instanceId: z.string(), count: z.number().positive() }))
        .optional(),
      customStackHourlyUsd: z.number().nonnegative().optional(),
      autoSelectGpuInstance: z.boolean().optional(),
    })
    .optional(),
  hyperscaler: z
    .object({
      cloud: z.enum(["aws", "azure", "gcp"]),
      region: z.string(),
      mode: z.enum(["managedApi", "selfHostedGpu"]),
      managedModelId: z.string().optional(),
      embeddingModelId: z.string().optional(),
      gpuInstanceId: z.string().optional(),
      selfHostedModelId: z.string().optional(),
    })
    .optional(),
  aws: z
    .object({
      mode: z.enum(["bedrock", "ec2"]),
      bedrockModelId: z.string().optional(),
      embeddingModelId: z.string().optional(),
      gpuInstanceId: z.string().optional(),
      selfHostedModelId: z.string().optional(),
      region: z.string(),
    })
    .optional(),
});
