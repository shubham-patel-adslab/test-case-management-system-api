import type { CacheMetricsSnapshot } from '../../app/cache.js';
import type { CacheMetricsResponseDto } from './metrics.response.dto.js';

const MS_DECIMALS = 100;

function average(totalMs: number, count: number): number | null {
    return count === 0 ? null : Math.round((totalMs / count) * MS_DECIMALS) / MS_DECIMALS;
}

export function toCacheMetricsResponseDto(snapshot: CacheMetricsSnapshot): CacheMetricsResponseDto {
    return {
        enabled: snapshot.isEnabled,
        redisStatus: snapshot.redisStatus,
        since: snapshot.since.toISOString(),
        lastError: snapshot.lastError && { message: snapshot.lastError.message, at: snapshot.lastError.at.toISOString() },
        caches: snapshot.caches.map((cache) => {
            const lookups = cache.hits + cache.misses;

            return {
                name: cache.name,
                ttlSeconds: cache.ttlSeconds,
                hits: cache.hits,
                misses: cache.misses,
                bypasses: cache.bypasses,
                errors: cache.errors,
                hitRate: lookups === 0 ? null : cache.hits / lookups,
                averageHitMs: average(cache.hitMs, cache.hits),
                averageMissMs: average(cache.missMs, cache.misses),
                averageBypassMs: average(cache.bypassMs, cache.bypasses),
            };
        }),
    };
}
