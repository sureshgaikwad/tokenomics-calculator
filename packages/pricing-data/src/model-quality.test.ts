import { describe, expect, it } from "vitest";
import { loadModelQualityCatalog, openWeightCatalogKey } from "./model-quality.js";

describe("model-quality catalog", () => {
  it("loads entries for managed and open models", () => {
    const bundle = loadModelQualityCatalog();
    expect(bundle.equivalenceClasses.length).toBeGreaterThan(2);
    expect(bundle.byCatalogKey[openWeightCatalogKey("llama-3.3-70b")]).toBeDefined();
    expect(bundle.byCatalogKey["aws:anthropic.claude-3-5-sonnet"]).toBeDefined();
  });
});
