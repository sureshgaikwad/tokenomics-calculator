import { describe, expect, it } from "vitest";
import { evaluateScenario } from "./compare.js";
import { EXAMPLE_SCENARIOS } from "./example-scenarios.js";

describe("example scenarios", () => {
  it("low volume: Bedrock cheaper than OpenShift", () => {
    const r = evaluateScenario(EXAMPLE_SCENARIOS.apiWinsLowVolume);
    expect(r.aws!.totalUsd).toBeLessThan(r.openshift!.totalUsd);
    expect(r.cheaperPath).toBe("hyperscaler");
  });

  it("high RAG vs Sonnet: OpenShift cheaper than Bedrock token spend", () => {
    const r = evaluateScenario(EXAMPLE_SCENARIOS.openshiftWinsHighRag);
    expect(r.aws!.totalUsd).toBeGreaterThan(r.openshift!.totalUsd);
    expect(r.cheaperPath).toBe("openshift");
  });
});
