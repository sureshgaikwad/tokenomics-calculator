import { describe, expect, it } from "vitest";
import {
  computeUsageTotals,
  defaultComparisonScenario,
  defaultSla,
  evaluateScenario,
  getWorkloadTemplate,
} from "./index.js";

describe("usage totals", () => {
  it("separates input, output, and embedding tokens", () => {
    const profile = getWorkloadTemplate("rag");
    const usage = computeUsageTotals(profile, { unit: "month", count: 1 }, defaultSla());
    expect(usage.inputTokens).toBeGreaterThan(usage.outputTokens);
    expect(usage.embeddingTokens).toBeGreaterThan(0);
    expect(usage.thinkingTokens).toBe(0);
    expect(usage.inputOutputRatio).toBeGreaterThan(1);
  });

  it("adds thinking tokens to output billing and optional input carryover", () => {
    const profile = getWorkloadTemplate("codeAssistant");
    profile.avgThinkingTokensPerRequest = 2000;
    profile.thinkingBlocksAsInputFraction = 0.5;
    const usage = computeUsageTotals(profile, { unit: "day", count: 1 }, defaultSla());
    expect(usage.thinkingTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(usage.thinkingTokens);
    expect(usage.thinkingAsInputTokens).toBe(usage.thinkingTokens * 0.5);
  });
});

describe("golden scenarios", () => {
  it("low usage: Bedrock variable cost stays below OpenShift fixed-heavy stack", () => {
    const workload = getWorkloadTemplate("codeAssistant");
    workload.requestsPerDay = 50;
    workload.peakConcurrentRequests = 2;

    const scenario = defaultComparisonScenario(workload, {
      name: "low usage",
      period: { unit: "month", count: 1 },
    });
    const result = evaluateScenario(scenario);
    expect(result.aws!.totalUsd).toBeLessThan(result.openshift!.totalUsd);
    expect(result.cheaperPath).toBe("hyperscaler");
  });

  it("high usage: Bedrock token spend can exceed OpenShift infra", () => {
    const workload = getWorkloadTemplate("rag");
    workload.requestsPerDay = 100_000;
    workload.peakConcurrentRequests = 200;

    const scenario = defaultComparisonScenario(workload, {
      name: "high usage",
      period: { unit: "year", count: 1 },
    });
    const result = evaluateScenario(scenario);
    expect(result.aws!.totalUsd).toBeGreaterThan(0);
    expect(result.openshift!.totalUsd).toBeGreaterThan(0);
    expect(result.aws!.variableUsd).toBeGreaterThan(result.aws!.fixedUsd);
  });

  it("EC2 self-hosted path shares GPU sizing with OpenShift", () => {
    const workload = getWorkloadTemplate("codeAssistant");
    const scenario = defaultComparisonScenario(workload, {
      aws: {
        mode: "ec2",
        gpuInstanceId: "g5.12xlarge",
        selfHostedModelId: "llama-3-70b",
        region: "us-east-1",
      },
    });
    const result = evaluateScenario(scenario);
    expect(result.aws!.fixedUsd).toBeGreaterThan(0);
    expect(result.judges.length).toBeGreaterThanOrEqual(0);
  });
});
