import { getCached, setCached, pricingCacheTtlMs } from "./cache.js";

const CACHE_KEY = "open-llm-leaderboard-index";
const DATASET = "open-llm-leaderboard%2Fcontents";
/** HF datasets-server /rows rejects length > 100 (HTTP 422). */
const BATCH = 100;
const BATCH_DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface HuggingFaceLeaderboardScores {
  average?: number;
  mmluPro?: number;
  gpqa?: number;
  ifeval?: number;
  mathLvl5?: number;
  fullname?: string;
  evalName?: string;
}

type LeaderboardRow = Record<string, unknown>;

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function scoresFromRow(row: LeaderboardRow): HuggingFaceLeaderboardScores {
  return {
    average: num(row["Average ⬆️"]),
    mmluPro: num(row["MMLU-PRO"]),
    gpqa: num(row["GPQA"]),
    ifeval: num(row["IFEval"]),
    mathLvl5: num(row["MATH Lvl 5"]),
    fullname: typeof row.fullname === "string" ? row.fullname : undefined,
    evalName: typeof row.eval_name === "string" ? row.eval_name : undefined,
  };
}

function better(
  a: HuggingFaceLeaderboardScores,
  b: HuggingFaceLeaderboardScores
): HuggingFaceLeaderboardScores {
  const avgA = a.average ?? -1;
  const avgB = b.average ?? -1;
  return avgA >= avgB ? a : b;
}

async function fetchLeaderboardSize(): Promise<number> {
  const url = `https://datasets-server.huggingface.co/size?dataset=${DATASET}&config=default`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HF size API ${res.status}`);
  const data = (await res.json()) as {
    size?: { config?: { num_rows?: number } };
  };
  const rows = data.size?.config?.num_rows;
  if (!rows || rows <= 0) throw new Error("HF leaderboard row count missing");
  return rows;
}

async function fetchLeaderboardBatch(offset: number, length: number): Promise<LeaderboardRow[]> {
  const url =
    `https://datasets-server.huggingface.co/rows?dataset=${DATASET}` +
    `&config=default&split=train&offset=${offset}&length=${length}`;

  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    lastStatus = res.status;
    if (res.ok) {
      const data = (await res.json()) as { rows?: Array<{ row: LeaderboardRow }> };
      return (data.rows ?? []).map((r) => r.row);
    }
    if (res.status === 429 || res.status === 503) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    throw new Error(`HF rows API ${res.status} at offset ${offset}`);
  }
  throw new Error(`HF rows API ${lastStatus} at offset ${offset} (retries exhausted)`);
}

/**
 * Builds fullname → best OLL scores (highest Average ⬆️ per repo).
 */
export async function fetchOpenLlmLeaderboardIndex(): Promise<
  Map<string, HuggingFaceLeaderboardScores>
> {
  const cached = getCached<Map<string, HuggingFaceLeaderboardScores>>(CACHE_KEY);
  if (cached) return cached;

  const total = await fetchLeaderboardSize();
  const index = new Map<string, HuggingFaceLeaderboardScores>();

  for (let offset = 0; offset < total; offset += BATCH) {
    const length = Math.min(BATCH, total - offset);
    const rows = await fetchLeaderboardBatch(offset, length);
    for (const row of rows) {
      const fullname = row.fullname;
      if (typeof fullname !== "string" || !fullname.includes("/")) continue;
      const scores = scoresFromRow(row);
      const prev = index.get(fullname);
      index.set(fullname, prev ? better(prev, scores) : scores);
    }
    if (offset + BATCH < total) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  setCached(CACHE_KEY, index, pricingCacheTtlMs());
  return index;
}

export function lookupLeaderboardScores(
  index: Map<string, HuggingFaceLeaderboardScores>,
  huggingFaceRepo: string
): HuggingFaceLeaderboardScores | undefined {
  const direct = index.get(huggingFaceRepo);
  if (direct) return direct;
  const lower = huggingFaceRepo.toLowerCase();
  for (const [key, val] of index) {
    if (key.toLowerCase() === lower) return val;
  }
  return undefined;
}
