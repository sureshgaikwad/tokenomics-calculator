import { describe, expect, it } from "vitest";
import { defaultComparisonScenario, getWorkloadTemplate } from "./index.js";
import { recommendGpuInstance, applyGpuRecommendation } from "./recommend-gpu.js";
import { computeUsageTotals } from "./usage.js";
import { defaultSla } from "./scenario-defaults.js";

describe("recommendGpuInstance", () => {
  it("picks g6e.2xlarge for Qwen3-Coder-30B FP8, not L4 g6.2xlarge", () => {
    const workload = getWorkloadTemplate("codeAssistant");
    const scenario = defaultComparisonScenario(workload, {
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        region: "us-east-1",
        useHcp: true,
        selfHostedModelId: "qwen3-coder-30b-a3b-fp8",
        gpuInstanceId: "g6.2xlarge",
        autoSelectGpuInstance: true,
      },
    });
    const usage = computeUsageTotals(workload, scenario.period, defaultSla());
    const rec = recommendGpuInstance(scenario, usage, scenario.period);
    expect(rec?.instanceId).toBe("g6e.2xlarge");
    expect(rec?.userInstanceAdequate).toBe(false);
  });

  it("picks inf2.24xlarge for Neuron Qwen BF16", () => {
    const workload = getWorkloadTemplate("codeAssistant");
    const scenario = defaultComparisonScenario(workload, {
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        region: "us-east-1",
        useHcp: true,
        selfHostedModelId: "qwen3-coder-30b-a3b-bf16-neuron",
        gpuInstanceId: "g6.2xlarge",
      },
    });
    const usage = computeUsageTotals(workload, scenario.period, defaultSla());
    const { scenario: applied, recommendation } = applyGpuRecommendation(
      scenario,
      usage,
      scenario.period
    );
    expect(recommendation?.instanceId).toMatch(/inf2/);
    expect(applied.openshift?.gpuInstanceId).toMatch(/inf2/);
  });

  it("scales to g5.12xlarge or multi-GPU for Llama 70B", () => {
    const workload = getWorkloadTemplate("rag");
    workload.peakConcurrentRequests = 30;
    const scenario = defaultComparisonScenario(workload, {
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        region: "us-east-1",
        useHcp: true,
        selfHostedModelId: "llama-3-70b",
        gpuInstanceId: "g6.2xlarge",
      },
    });
    const usage = computeUsageTotals(workload, scenario.period, defaultSla());
    const rec = recommendGpuInstance(scenario, usage, scenario.period);
    expect(rec?.physicalGpus).toBeGreaterThanOrEqual(2);
    expect(rec?.instanceId).not.toBe("g6.xlarge");
  });
});
