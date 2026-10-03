import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(__dirname, "..", "data");

function loadYaml<T>(relativePath: string): T {
  return parse(readFileSync(join(dataRoot, relativePath), "utf8")) as T;
}

export type FrontierClassification =
  | "comparison-target"
  | "comparable-on-selected-coding-benchmarks"
  | "requires-workload-specific-validation";

export interface CodingWorkloadPreset {
  id: string;
  label: string;
  avgInputTokensPerRequest: number;
  avgOutputTokensPerRequest: number;
  requestsPerActiveDeveloperPerHour: number;
  targetOutputTokensPerSecPerUser: number;
  contextTokens: number;
  p95TtftSeconds: number;
}

export interface CodingWorkloadDefaults {
  developers: number;
  peakActivePercentage: number;
  generationConcurrencyPercentage: number;
  activeHoursPerDay: number;
  runtimeOverheadFraction: number;
  safetyMarginFraction: number;
  kvCacheGbPerActiveSequence: number;
}

export interface CodingWorkloadCatalog {
  version: string;
  source: string;
  description?: string;
  presets: CodingWorkloadPreset[];
  defaults: CodingWorkloadDefaults;
}

export interface FrontierModel {
  id: string;
  displayName: string;
  provider: string;
  cloudBindings?: Partial<Record<"aws" | "azure" | "gcp", string>>;
  role: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  maxContextTokens: number;
  priceIsAssumption?: boolean;
  notes?: string;
  lastUpdated?: string;
}

export interface FrontierCatalog {
  version: string;
  effectiveDate: string;
  source: string;
  models: FrontierModel[];
}

export interface CodingGpuType {
  id: string;
  gpuName: string;
  gpuMemoryGb: number;
  usableMemoryFactor: number;
}

export interface CodingGpuInstance {
  id: string;
  displayName: string;
  cloudProvider: string;
  region: string;
  instanceType: string;
  gpuId: string;
  gpusPerInstance: number;
  instanceHourlyCost: Record<string, number>;
  priceIsAssumption?: boolean;
  availabilityNotes?: string;
}

export interface CodingGpuInfraCatalog {
  version: string;
  effectiveDate: string;
  source: string;
  currency: string;
  gpus: CodingGpuType[];
  extraGpus?: CodingGpuType[];
  instances: CodingGpuInstance[];
}

export interface CodingModelFrontierComparison {
  frontierModelId: string;
  classification: FrontierClassification;
  evidenceNote?: string;
}

export interface CodingModel {
  modelId: string;
  modelName: string;
  modelFamily: string;
  totalParametersB: number | null;
  activeParametersB: number | null;
  architecture: string;
  precision: string;
  weightMemoryGb: number;
  weightMemoryIsAssumption?: boolean;
  maximumContext: number;
  recommendedContext: number;
  minimumGpuMemoryGb: number;
  minimumGpuCount: number;
  recommendedGpuType: string;
  tensorParallelRequirement: number;
  estimatedPrefillThroughputTokPerSec: number | null;
  estimatedDecodeThroughputTokPerSecPerGpu: number | null;
  estimatedConcurrentSequences: number | null;
  throughputIsAssumption?: boolean;
  frontierComparison: CodingModelFrontierComparison;
  openWeightBridgeId?: string | null;
  benchmarkNotes?: string;
  source?: string;
  lastUpdated?: string;
}

export interface CodingModelCatalog {
  version: string;
  effectiveDate: string;
  source: string;
  models: CodingModel[];
}

export interface CodingCatalogBundle {
  workloads: CodingWorkloadCatalog;
  models: CodingModelCatalog;
  frontier: FrontierCatalog;
  gpuInfra: CodingGpuInfraCatalog;
}

export function loadCodingWorkloadCatalog(): CodingWorkloadCatalog {
  return loadYaml<CodingWorkloadCatalog>("coding/workload-presets.yaml");
}

export function loadCodingModelCatalog(): CodingModelCatalog {
  return loadYaml<CodingModelCatalog>("coding/coding-models.yaml");
}

export function loadFrontierCatalog(): FrontierCatalog {
  return loadYaml<FrontierCatalog>("coding/frontier-models.yaml");
}

export function loadCodingGpuInfra(): CodingGpuInfraCatalog {
  return loadYaml<CodingGpuInfraCatalog>("coding/gpu-infra.yaml");
}

export function loadCodingCatalogs(): CodingCatalogBundle {
  return {
    workloads: loadCodingWorkloadCatalog(),
    models: loadCodingModelCatalog(),
    frontier: loadFrontierCatalog(),
    gpuInfra: loadCodingGpuInfra(),
  };
}

export function listCodingGpuTypes(catalog: CodingGpuInfraCatalog): CodingGpuType[] {
  return [...catalog.gpus, ...(catalog.extraGpus ?? [])];
}

export function findCodingModel(
  catalog: CodingModelCatalog,
  modelId: string
): CodingModel | undefined {
  return catalog.models.find((m) => m.modelId === modelId);
}

export function findFrontierModel(
  catalog: FrontierCatalog,
  modelId: string
): FrontierModel | undefined {
  return catalog.models.find((m) => m.id === modelId);
}

export function findCodingGpuInstance(
  catalog: CodingGpuInfraCatalog,
  instanceId: string
): CodingGpuInstance | undefined {
  return catalog.instances.find((i) => i.id === instanceId);
}

export function findCodingGpuType(
  catalog: CodingGpuInfraCatalog,
  gpuId: string
): CodingGpuType | undefined {
  return listCodingGpuTypes(catalog).find((g) => g.id === gpuId);
}
