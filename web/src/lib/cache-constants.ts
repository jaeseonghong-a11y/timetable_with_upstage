export const SESSION_COOKIE_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
export const ELECTIVE_CATALOG_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12시간
export const ELECTIVE_SECTIONS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12시간
export const MAJOR_COURSES_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

/**
 * TTL used when a Blob(L2) cache hit repopulates the in-memory L1 cache — see TieredCacheStore.
 * Deliberately much shorter than the 12시간 L2 TTL: it only needs to cover this one warm
 * serverless instance's remaining lifetime, not the blob's actual remaining freshness window.
 */
export const CATALOG_L1_REPOPULATE_TTL_MS = 10 * 60 * 1000; // 10분
