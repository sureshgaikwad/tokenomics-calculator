const DEFAULT_TTL_MS = 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function pricingCacheTtlMs(): number {
  const raw = process.env.PRICING_CACHE_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_MS;
  const sec = Number(raw);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : DEFAULT_TTL_MS;
}
