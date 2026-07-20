import { get as getBlob, put as putBlob } from "@vercel/blob";

import type { CacheStore } from "./cache-store";

const BLOB_ACCESS = "private" as const;

interface CacheEnvelope<T> {
  value: T;
  expiresAt: number;
}

function isEnvelope<T>(value: unknown): value is CacheEnvelope<T> {
  return (
    typeof value === "object" && value !== null && typeof (value as { expiresAt?: unknown }).expiresAt === "number"
  );
}

/**
 * Vercel Blob-backed CacheStore — the L2 layer behind TieredCacheStore. Unlike InMemoryTtlCache,
 * this survives serverless cold starts (a fresh instance still finds what a *different* instance
 * already wrote), which is what actually fixes the ~10s cold 교양/전공 fetch for every user after
 * the first one on a given instance. Every failure (no BLOB_READ_WRITE_TOKEN locally, network
 * error, malformed blob) is swallowed and treated as a miss/no-op — this is a speed optimization
 * layered on top of the SKKU fetch, never a correctness dependency, so it must never turn a
 * request that would otherwise succeed into a failing one.
 */
export class BlobTtlCache<T> implements CacheStore<T> {
  constructor(private readonly namespace: string) {}

  private pathname(key: string): string {
    // No percent-encoding here on purpose: get() resolves a pathname by building a direct CDN URL
    // and letting fetch/the server interpret it, which *decodes* %-escapes back (e.g. %3A -> ":")
    // before matching against the stored object key — so a pre-encoded key round-trips to a
    // different key than the one put() actually wrote and every read 404s as a silent cache miss.
    // Cache keys here are always our own ":"-joined query fields (see skku-course-api.ts), which
    // Blob's only disallowed pathname character ("//") never appears in, so no encoding is needed.
    return `skku-cache/${this.namespace}/${key}.json`;
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const result = await getBlob(this.pathname(key), { access: BLOB_ACCESS, useCache: false });
      if (!result || result.statusCode !== 200) {
        return undefined;
      }
      const parsed: unknown = await new Response(result.stream).json();
      if (!isEnvelope<T>(parsed) || parsed.expiresAt <= Date.now()) {
        return undefined;
      }
      return parsed.value;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      const envelope: CacheEnvelope<T> = { value, expiresAt: Date.now() + ttlMs };
      await putBlob(this.pathname(key), JSON.stringify(envelope), {
        access: BLOB_ACCESS,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
    } catch {
      // Best-effort cache write; a failure here must not fail the caller's real request.
    }
  }
}
