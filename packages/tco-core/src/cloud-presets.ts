import type { HyperscalerCloud, OpenShiftPlatform } from "./types.js";

export const MANAGED_AI_SERVICE: Record<HyperscalerCloud, string> = {
  aws: "Amazon Bedrock",
  azure: "Azure OpenAI",
  gcp: "Vertex AI",
};

export const DEFAULT_MANAGED_MODEL: Record<HyperscalerCloud, string> = {
  aws: "anthropic.claude-3-5-sonnet",
  azure: "azure-gpt-4o",
  gcp: "vertex-gemini-2.0-flash",
};

export const DEFAULT_EMBEDDING_MODEL: Record<HyperscalerCloud, string> = {
  aws: "amazon.titan-embed-text-v2",
  azure: "text-embedding-3-small",
  gcp: "text-embedding-004",
};

export const DEFAULT_REGION: Record<HyperscalerCloud, string> = {
  aws: "us-east-1",
  azure: "eastus",
  gcp: "us-central1",
};

export const DEFAULT_GPU_INSTANCE: Record<HyperscalerCloud, string> = {
  aws: "g6.2xlarge",
  azure: "Standard_NC4as_T4_v3",
  gcp: "g2-standard-4",
};

/** OpenShift platform that typically pairs with each hyperscaler for apples-to-apples region alignment */
export function defaultOpenShiftPlatform(cloud: HyperscalerCloud): OpenShiftPlatform {
  if (cloud === "azure") return "aro";
  if (cloud === "gcp") return "osd";
  return "rosa";
}

export function openshiftRegionForCloud(cloud: HyperscalerCloud, hyperscalerRegion: string): string {
  if (cloud === "aws") return hyperscalerRegion;
  if (cloud === "azure") return hyperscalerRegion;
  return hyperscalerRegion;
}
