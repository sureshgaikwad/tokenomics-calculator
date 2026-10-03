import { describe, expect, it } from "vitest";
import { loadAllPricing } from "./index.js";

describe("pricing data", () => {
  it("loads all YAML catalogs", () => {
    const all = loadAllPricing();
    expect(all.rosa.workerFeePer4VcpuHour.onDemand).toBe(0.171);
    expect(all.bedrock.models.length).toBeGreaterThan(0);
    expect(all.ec2Gpu.instances.length).toBeGreaterThan(0);
  });
});
