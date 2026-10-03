import { describe, expect, it } from "vitest";
import { evaluateScenario, getWorkloadTemplate, defaultComparisonScenario, defaultSla } from "./index.js";
import { computeUsageTotals } from "./usage.js";

describe("agentic workload", () => {
  it("accumulates large thinking and input token volumes", () => {
    const profile = getWorkloadTemplate("agentic");
    const usage = computeUsageTotals(profile, { unit: "month", count: 1 }, defaultSla());
    expect(usage.thinkingTokens).toBeGreaterThan(500_000_000);
    expect(usage.inputTokens).toBeGreaterThan(1_000_000_000);
    expect(usage.thinkingTokens).toBeGreaterThan(
      usage.outputTokens - usage.thinkingTokens
    );
  });

  it("Bedrock variable cost is high vs modest OpenShift at template defaults", () => {
    const workload = getWorkloadTemplate("agentic");
    const scenario = defaultComparisonScenario(workload, {
      openshift: {
        platform: "rosa",
        licensingMode: "managedCloudService",
        region: "us-east-1",
        gpuInstanceId: "g6e.2xlarge",
        selfHostedModelId: "qwen3-coder-30b-a3b-fp8",
        workerCount: 6,
        useHcp: true,
      },
      aws: {
        mode: "bedrock",
        bedrockModelId: "anthropic.claude-3-5-sonnet",
        region: "us-east-1",
      },
    });
    const result = evaluateScenario(scenario);
    expect(result.aws!.variableUsd).toBeGreaterThan(result.aws!.fixedUsd);
    expect(result.judges.some((j) => j.id === "agentic-low-thinking")).toBe(false);
  });
});
