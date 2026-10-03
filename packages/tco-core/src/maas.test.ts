import { describe, expect, it } from "vitest";
import {
  defaultComparisonScenario,
  evaluateScenario,
  getWorkloadTemplate,
} from "./index.js";

describe("maas workload", () => {
  it("exposes platform-scale defaults", () => {
    const profile = getWorkloadTemplate("maas");
    expect(profile.kind).toBe("maas");
    expect(profile.requestsPerDay).toBeGreaterThan(50_000);
    expect(profile.peakConcurrentRequests).toBeGreaterThan(100);
    expect(profile.maasConsumerCount).toBeGreaterThan(0);
  });

  it("flags bedrock scale crossover hint at default volume", () => {
    const workload = getWorkloadTemplate("maas");
    const scenario = defaultComparisonScenario(workload, {
      aws: { mode: "bedrock", bedrockModelId: "anthropic.claude-3-5-sonnet", region: "us-east-1" },
    });
    const result = evaluateScenario(scenario);
    expect(result.judges.some((j) => j.id === "maas-bedrock-scale")).toBe(true);
  });
});
