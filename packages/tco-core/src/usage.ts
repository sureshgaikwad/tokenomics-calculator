import type { UsagePeriod, UsageTotals, WorkloadProfile } from "./types.js";
import type { SlaConfig } from "./types.js";

export function periodToDays(period: UsagePeriod): number {
  switch (period.unit) {
    case "day":
      return period.count;
    case "month":
      return period.count * 30;
    case "year":
      return period.count * 365;
  }
}

export function computeUsageTotals(
  profile: WorkloadProfile,
  period: UsagePeriod,
  sla: SlaConfig
): UsageTotals {
  const periodDays = periodToDays(period);
  const fudge = sla.tokenCountFudgeFactor;
  const llmRequests = profile.requestsPerDay * periodDays;
  const embedOnlyFrac = profile.embeddingOnlyRequestFraction ?? 0;
  const llmOnlyRequests = llmRequests * (1 - embedOnlyFrac);

  const thinkingPerReq = profile.avgThinkingTokensPerRequest ?? 0;
  const thinkingTokens = llmOnlyRequests * thinkingPerReq * fudge;
  const thinkingAsInputFrac = profile.thinkingBlocksAsInputFraction ?? 0;
  const thinkingAsInputTokens = thinkingTokens * thinkingAsInputFrac;

  const inputTokens =
    llmOnlyRequests * profile.avgInputTokensPerRequest * fudge + thinkingAsInputTokens;
  const outputTokens = llmOnlyRequests * profile.avgOutputTokensPerRequest * fudge + thinkingTokens;

  const perRequestEmbed = profile.embeddingTokensPerLlmRequest ?? 0;
  const corpusEmbed = profile.monthlyCorpusEmbeddingTokens ?? 0;
  const monthsInPeriod = periodDays / 30;
  const embeddingTokens =
    llmOnlyRequests * perRequestEmbed * fudge + corpusEmbed * monthsInPeriod * fudge;

  const inputOutputRatio = outputTokens > 0 ? inputTokens / outputTokens : Infinity;

  return {
    periodDays,
    llmRequests,
    inputTokens,
    outputTokens,
    thinkingTokens,
    thinkingAsInputTokens,
    embeddingTokens,
    inputOutputRatio,
  };
}
