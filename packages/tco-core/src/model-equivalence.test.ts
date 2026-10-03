import { loadModelQualityCatalog } from "@tokenomics/pricing-data";
import { describe, expect, it } from "vitest";
import { defaultComparisonScenario } from "./scenario-defaults.js";
import { getWorkloadTemplate } from "./workloads.js";
import { compareModelQuality, modelEquivalenceJudges } from "./model-equivalence.js";

describe("model equivalence", () => {
  const quality = loadModelQualityCatalog();

  it("flags tier mismatch between frontier API and small open model", () => {
    const workload = getWorkloadTemplate("rag");
    const scenario = defaultComparisonScenario(workload, {
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        useHcp: true,
        gpuInstanceId: "g6.2xlarge",
        selfHostedModelId: "llama-3-8b",
        region: "us-east-1",
        autoSelectGpuInstance: true,
      },
      hyperscaler: {
        cloud: "aws",
        region: "us-east-1",
        mode: "managedApi",
        managedModelId: "anthropic.claude-3-5-sonnet",
      },
    });

    const cmp = compareModelQuality(scenario, quality);
    expect(cmp?.sameEquivalenceClass).toBe(false);
    const judges = modelEquivalenceJudges(scenario, quality);
    expect(judges.some((j) => j.id === "model-quality-tier-mismatch")).toBe(true);
  });

  it("matches llama 3.3 70b open tier to strong-open API llama", () => {
    const workload = getWorkloadTemplate("rag");
    const scenario = defaultComparisonScenario(workload, {
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        useHcp: true,
        gpuInstanceId: "g5.12xlarge",
        selfHostedModelId: "llama-3.3-70b",
        region: "us-east-1",
        autoSelectGpuInstance: true,
      },
      hyperscaler: {
        cloud: "aws",
        region: "us-east-1",
        mode: "managedApi",
        managedModelId: "meta.llama3-3-70b-instruct",
      },
    });

    const cmp = compareModelQuality(scenario, quality);
    expect(cmp?.sameEquivalenceClass).toBe(true);
  });
});
