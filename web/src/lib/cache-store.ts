export interface CacheStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): Promise<void>;
}

export class InMemoryTtlCache<T> implements CacheStore<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  async get(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Combines a fast in-memory L1 (lives only inside one warm serverless instance) with a slower,
 * durable L2 that survives cold starts (e.g. a Blob-backed store) — see defaultElectiveCatalogCache
 * / defaultMajorCoursesCache in skku-course-api.ts. An L2 hit repopulates L1 using
 * `l1RepopulateTtlMs` rather than the entry's real remaining TTL (this interface doesn't expose
 * that), so the *same* warm instance can answer the next request instantly without another L2
 * round trip.
 */
export class TieredCacheStore<T> implements CacheStore<T> {
  constructor(
    private readonly l1: InMemoryTtlCache<T>,
    private readonly l2: CacheStore<T>,
    private readonly l1RepopulateTtlMs: number,
  ) {}

  async get(key: string): Promise<T | undefined> {
    const local = await this.l1.get(key);
    if (local !== undefined) {
      return local;
    }
    const remote = await this.l2.get(key);
    if (remote !== undefined) {
      await this.l1.set(key, remote, this.l1RepopulateTtlMs);
    }
    return remote;
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    await this.l1.set(key, value, ttlMs);
    await this.l2.set(key, value, ttlMs);
  }

  clear(): void {
    this.l1.clear();
  }
}
