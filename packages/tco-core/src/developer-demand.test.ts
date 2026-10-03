import { loadCodingCatalogs } from "@tokenomics/pricing-data";
import { describe, expect, it } from "vitest";
import { computeDeveloperDemand } from "./developer-demand.js";
import { sizeCodingInfrastructure } from "./coding-gpu-sizing.js";
import { applyDeveloperPopulation } from "./apply-developer-population.js";
import { defaultComparisonScenario } from "./scenario-defaults.js";
import { getWorkloadTemplate } from "./workloads.js";
import { evaluateScenario, getPricing } from "./index.js";

describe("developer demand sizing", () => {
  const coding = loadCodingCatalogs();

  it("derives concurrent requests from population, not GPU×developers", () => {
    const demand = computeDeveloperDemand(
      {
        developers: 200,
        peakActivePercentage: 0.25,
        generationConcurrencyPercentage: 0.4,
        intensityPreset: "standard",
      },
      coding.workloads.defaults,
      coding.workloads.presets
    );

    expect(demand.activeDevelopers).toBe(50);
    expect(demand.concurrentRequests).toBe(20);
    expect(demand.requiredOutputTokensPerSec).toBe(600);
  });

  it("requires both memory and throughput for a valid topology", () => {
    const demand = computeDeveloperDemand(
      {
        developers: 200,
        peakActivePercentage: 0.25,
        generationConcurrencyPercentage: 0.4,
        intensityPreset: "standard",
        decodeTokensPerSecPerGpuOverride: 80,
      },
      coding.workloads.defaults,
      coding.workloads.presets
    );
    const model = coding.models.models.find((m) => m.modelId === "qwen3-coder-30b-a3b-fp8")!;
    const result = sizeCodingInfrastructure({
      demand,
      model,
      catalog: coding,
      commitment: "oneYear",
      haExtraReplicas: 1,
      decodeTokensPerSecPerGpuOverride: 80,
    });

    expect(result.selected).toBeDefined();
    expect(result.selected!.memoryOk).toBe(true);
    expect(result.selected!.throughputOk).toBe(true);
    expect(result.selected!.valid).toBe(true);
  });

  it("evaluateScenario attaches codingInfra when developerPopulation is set", () => {
    const workload = getWorkloadTemplate("codeAssistant");
    const scenario = defaultComparisonScenario(workload, {
      codingModelId: "qwen3-coder-30b-a3b-fp8",
      developerPopulation: {
        developers: 200,
        peakActivePercentage: 0.25,
        generationConcurrencyPercentage: 0.4,
        intensityPreset: "standard",
        decodeTokensPerSecPerGpuOverride: 100,
      },
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        useHcp: true,
        gpuInstanceId: "g6e.2xlarge",
        selfHostedModelId: "qwen3-coder-30b-a3b-fp8",
        region: "us-east-1",
        autoSelectGpuInstance: true,
      },
    });

    const { codingInfra } = applyDeveloperPopulation(scenario, getPricing());
    expect(codingInfra?.demand.concurrentRequests).toBe(20);

    const result = evaluateScenario(scenario);
    expect(result.codingInfra?.demand.concurrentRequests).toBe(20);
    expect(result.openshift?.totalUsd).toBeGreaterThan(0);
  });
});
