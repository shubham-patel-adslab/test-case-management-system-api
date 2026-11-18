import { z } from 'zod';

const count = () => z.number().int().nonnegative();
// null until there is something to average.
const averageMs = () => z.number().nonnegative().nullable();

export const cacheMetricsEntryResponseSchema = z.object({
    name: z.string(),
    ttlSeconds: count(),
    hits: count(),
    misses: count(),
    // Served without the cache: caching off, or Redis unreachable.
    bypasses: count(),
    // Redis commands that failed (the request was still answered, from the database).
    errors: count(),
    // hits / (hits + misses); null before the first cached read.
    hitRate: z.number().min(0).max(1).nullable(),
    // Service time of a request, authorization excluded: from Redis on a hit, from the database plus storing on a miss.
    averageHitMs: averageMs(),
    averageMissMs: averageMs(),
    averageBypassMs: averageMs(),
});

export const cacheMetricsResponseSchema = z
    .object({
        enabled: z.boolean(),
        // ioredis connection state: ready, connecting, reconnecting, … — or disabled.
        redisStatus: z.string(),
        // Counters are kept in this API process's memory since this time (they reset on restart).
        since: z.iso.datetime(),
        lastError: z.object({ message: z.string(), at: z.iso.datetime() }).nullable(),
        caches: z.array(cacheMetricsEntryResponseSchema),
    })
    .meta({ id: 'CacheMetricsResponse' });

export type CacheMetricsResponseDto = z.infer<typeof cacheMetricsResponseSchema>;
