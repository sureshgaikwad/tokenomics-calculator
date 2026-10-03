import { describe, expect, it } from "vitest";
import { evaluateScenario } from "./compare.js";
import { listPcaPhases, scenarioFromPcaPhase } from "./pca-reference.js";

describe("PCA reference phases", () => {
  it("loads phases from catalog", () => {
    expect(listPcaPhases().length).toBeGreaterThanOrEqual(4);
  });

  it("phase 1 documents L40S stack near PCA benchmark $/hr", () => {
    const scenario = scenarioFromPcaPhase("pca-phase-1");
    const phase = listPcaPhases().find((p) => p.id === "pca-phase-1");
    const result = evaluateScenario(scenario);
    const gpuAnnual = result
      .openshift!.lineItems.filter((i) => i.id.startsWith("gpu-"))
      .reduce((s, i) => s + i.amountUsd, 0);
    expect(gpuAnnual / 8760).toBeCloseTo(phase!.benchmark.costPerHourUsd!, 1);
  });

  it("phase 2: Bedrock token spend exceeds OpenShift at documented fleet scale", () => {
    const scenario = scenarioFromPcaPhase("pca-phase-2");
    const result = evaluateScenario(scenario);
    expect(result.aws!.totalUsd).toBeGreaterThan(result.openshift!.totalUsd);
    expect(result.cheaperPath).toBe("openshift");
  });

  it("phase 2 matches cross-phase hourly benchmark from fleet catalog", () => {
    const scenario = scenarioFromPcaPhase("pca-phase-2");
    const phase = listPcaPhases().find((p) => p.id === "pca-phase-2");
    const result = evaluateScenario(scenario);
    const hours = 8760;
    const gpuItems = result.openshift!.lineItems.filter((i) => i.id.startsWith("gpu-"));
    const gpuAnnual = gpuItems.reduce((s, i) => s + i.amountUsd, 0);
    expect(phase?.benchmark.costPerHourUsd).toBe(4.48);
    expect(gpuAnnual / hours).toBeCloseTo(4.48, 1);
  });
});
