import type { HyperscalerCloud, HyperscalerConfig, ScenarioInput } from "./types.js";

function fromAwsBlock(aws: NonNullable<ScenarioInput["aws"]>): HyperscalerConfig {
  return {
    cloud: "aws",
    region: aws.region,
    mode: aws.mode === "bedrock" ? "managedApi" : "selfHostedGpu",
    managedModelId: aws.bedrockModelId,
    embeddingModelId: aws.embeddingModelId,
    gpuInstanceId: aws.gpuInstanceId,
    selfHostedModelId: aws.selfHostedModelId,
  };
}

/** Normalize legacy `aws` block into `hyperscaler`. */
export function resolveHyperscaler(scenario: ScenarioInput): HyperscalerConfig | undefined {
  if (scenario.aws) {
    const fromAws = fromAwsBlock(scenario.aws);
    if (!scenario.hyperscaler) return fromAws;
    if (scenario.aws.mode === "ec2" && scenario.hyperscaler.mode === "managedApi") {
      return fromAws;
    }
  }
  if (scenario.hyperscaler) return scenario.hyperscaler;
  return undefined;
}

export function withResolvedHyperscaler(scenario: ScenarioInput): ScenarioInput {
  const h = resolveHyperscaler(scenario);
  if (!h) return scenario;
  return { ...scenario, hyperscaler: h };
}

/** GPU catalog / inference fleet pricing aligns with comparison cloud when set. */
export function inferenceCloudForScenario(scenario: ScenarioInput): HyperscalerCloud {
  const h = resolveHyperscaler(scenario);
  if (h) return h.cloud;
  if (scenario.openshift?.platform === "aro") return "azure";
  return "aws";
}
