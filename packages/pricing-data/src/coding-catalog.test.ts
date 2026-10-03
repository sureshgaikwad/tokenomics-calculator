import { describe, expect, it } from "vitest";
import { loadCodingCatalogs } from "./coding-catalog.js";

describe("coding catalogs", () => {
  it("loads models, frontier targets, GPU infra, and presets", () => {
    const c = loadCodingCatalogs();
    expect(c.workloads.presets.map((p) => p.id)).toContain("standard");
    expect(c.models.models.some((m) => m.modelId === "qwen3-coder-next")).toBe(true);
    expect(c.models.models.some((m) => m.modelId === "minimax-m2.5")).toBe(true);
    expect(c.models.models.some((m) => m.modelId === "deepseek-v3.2")).toBe(true);
    expect(c.models.models.some((m) => m.modelId === "glm-5")).toBe(true);
    expect(c.frontier.models.some((m) => m.id === "openai.gpt-6-astra")).toBe(true);
    expect(c.gpuInfra.instances.some((i) => i.gpuId === "nvidia-h100-80gb")).toBe(true);
    expect(c.gpuInfra.instances.some((i) => i.gpuId === "nvidia-h200-141gb")).toBe(true);
    expect(c.gpuInfra.instances.some((i) => i.gpuId === "nvidia-b200-180gb")).toBe(true);
  });
});
