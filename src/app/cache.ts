// Redis caching (PRD Backend Req §1): cache-aside reads, invalidation on writes, and hit/miss metrics. The one
// module that talks to Redis — features only call readThrough() and invalidateProjectCaches().
//
// Invalidation by version: every cached value belongs to one or more projects, and each (cache, project) pair has
// a random version token in Redis. The entry key includes the tokens of all its projects; a write to a project
// replaces that project's token, so every entry that includes the project is never read again (it expires on its
// TTL). No key scanning, and a cross-project dashboard is invalidated by a write to any of its projects. It is
// also race-free: a reader reads the tokens before the database, so a value it loaded from pre-commit data is
// stored under the old token, which no later request uses.
//
// Redis is an optimization, never a dependency: when it is off, down or slow, a request reads the database
// (X-Cache: BYPASS) and the failure is counted in the metrics instead of failing the request.
import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Redis } from 'ioredis';
import type { PoolClient } from 'pg';

import { withTransaction } from './database.js';
import { env } from './env.js';

const KEY_PREFIX = 'tcms:cache';
// Longer than any entry's TTL. An expired token just gets a new one: the entries under the old one are skipped.
const VERSION_TTL_SECONDS = 24 * 3600;
// A slow Redis must not slow the API down: past this, the request reads the database instead.
const COMMAND_TIMEOUT_MS = 500;
const CONNECT_TIMEOUT_MS = 2_000;

export const CACHE_STATUS_HEADER = 'X-Cache';

// The PRD's TTLs (Backend Req §1).
export const CACHE_POLICY = {
    ANALYTICS: { name: 'analytics', ttlSeconds: 15 * 60 },
    TEST_SUITE_LIST: { name: 'test-suite-list', ttlSeconds: 30 * 60 },
    PROJECT: { name: 'project', ttlSeconds: 60 * 60 },
} as const;

export type CachePolicy = (typeof CACHE_POLICY)[keyof typeof CACHE_POLICY];
export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';
export type Cached<T> = { value: T; cacheStatus: CacheStatus };

type CacheCounters = {
    hits: number;
    misses: number;
    bypasses: number;
    errors: number;
    hitMs: number;
    missMs: number;
    bypassMs: number;
};

export type CacheMetricsSnapshot = {
    isEnabled: boolean;
    redisStatus: string;
    since: Date;
    lastError: { message: string; at: Date } | null;
    caches: (CachePolicy & CacheCounters)[];
};

// In this process's memory (user decision): reset on restart, per API instance.
const countersStartedAt = new Date();
const counters = new Map<string, CacheCounters>(
    Object.values(CACHE_POLICY).map((policy) => [policy.name, { hits: 0, misses: 0, bypasses: 0, errors: 0, hitMs: 0, missMs: 0, bypassMs: 0 }]),
);
let lastError: CacheMetricsSnapshot['lastError'] = null;

// Connected by connectCache() (server start, test setup), not on import, so CLI scripts that never cache don't
// hold a connection open. Without an offline queue, commands fail at once while Redis is unreachable (→ BYPASS)
// instead of waiting; ioredis keeps reconnecting in the background.
const redis = env.CACHE_ENABLED && env.REDIS_URL
    ? new Redis(env.REDIS_URL, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: COMMAND_TIMEOUT_MS,
        connectTimeout: CONNECT_TIMEOUT_MS,
    })
    : null;

function recordError(error: unknown): void {
    lastError = { message: error instanceof Error ? error.message : String(error), at: new Date() };
}

// Without a listener, ioredis's 'error' events would crash the process; the last one shows in the metrics.
redis?.on('error', recordError);

function countersOf(policy: CachePolicy): CacheCounters {
    const policyCounters = counters.get(policy.name);

    if (!policyCounters) {
        throw new Error(`Unknown cache ${policy.name}`);
    }

    return policyCounters;
}

function record(policy: CachePolicy, status: CacheStatus, startedAtMs: number): void {
    const policyCounters = countersOf(policy);
    const elapsedMs = performance.now() - startedAtMs;

    if (status === 'HIT') {
        policyCounters.hits++;
        policyCounters.hitMs += elapsedMs;
    } else if (status === 'MISS') {
        policyCounters.misses++;
        policyCounters.missMs += elapsedMs;
    } else {
        policyCounters.bypasses++;
        policyCounters.bypassMs += elapsedMs;
    }
}

function recordPolicyError(policy: CachePolicy, error: unknown): void {
    countersOf(policy).errors++;
    recordError(error);
}

function versionKey(policy: CachePolicy, projectId: number): string {
    return `${KEY_PREFIX}:${policy.name}:version:${projectId}`;
}

function newVersion(): string {
    return randomBytes(9).toString('base64url');
}

// The current token of each project, creating missing ones (first read, or expired). SET NX: of two concurrent
// readers creating the same token, one wins and both read it back.
async function currentVersions(client: Redis, policy: CachePolicy, projectIds: number[]): Promise<string[]> {
    const keys = projectIds.map((projectId) => versionKey(policy, projectId));
    const versions = await client.mget(keys);
    const missingKeys = keys.filter((_key, index) => versions[index] === null);

    if (missingKeys.length === 0) {
        return versions.map((version) => version ?? '');
    }

    const pipeline = client.pipeline();
    missingKeys.forEach((key) => pipeline.set(key, newVersion(), 'EX', VERSION_TTL_SECONDS, 'NX'));
    throwIfFailed(await pipeline.exec());

    const created = await client.mget(keys);

    if (created.some((version) => version === null)) {
        throw new Error(`Cache version missing right after creating it (${policy.name})`);
    }

    return created.map((version) => version ?? '');
}

function throwIfFailed(results: [Error | null, unknown][] | null): void {
    const failure = results?.find(([error]) => error !== null)?.[0];

    if (failure) {
        throw failure;
    }
}

// `key` identifies the value within its projects (e.g. the query parameters); hashed with the projects' tokens so
// any length of input gives a short key.
async function entryKey(client: Redis, policy: CachePolicy, projectIds: readonly number[], key: string): Promise<string> {
    const sortedIds = [...new Set(projectIds)].sort((a, b) => a - b);
    const versions = sortedIds.length > 0 ? await currentVersions(client, policy, sortedIds) : [];
    const digest = createHash('sha256')
        .update(JSON.stringify({ key, projects: sortedIds.map((projectId, index) => [projectId, versions[index]]) }))
        .digest('base64url');

    return `${KEY_PREFIX}:${policy.name}:${digest}`;
}

// Cache-aside: the cached value if there is one, else load() — from the database — stored for the policy's TTL.
// `projectIds` are the projects the value depends on (a write to any of them invalidates it). Only call it after
// the authorization checks: the cache knows nothing about who may read what. The value goes through JSON, so it
// must be plain data (response DTOs are).
export async function readThrough<T>(policy: CachePolicy, projectIds: readonly number[], key: string, load: () => Promise<T>): Promise<Cached<T>> {
    const startedAtMs = performance.now();

    if (!redis) {
        const value = await load();
        record(policy, 'BYPASS', startedAtMs);

        return { value, cacheStatus: 'BYPASS' };
    }

    let cacheKey: string;

    try {
        cacheKey = await entryKey(redis, policy, projectIds, key);
        const cachedJson = await redis.get(cacheKey);

        if (cachedJson !== null) {
            // Written by this module from the same type; JSON can't carry the type, hence the assertion.
            const value = JSON.parse(cachedJson) as T;
            record(policy, 'HIT', startedAtMs);

            return { value, cacheStatus: 'HIT' };
        }
    } catch (error) {
        recordPolicyError(policy, error);
        const value = await load();
        record(policy, 'BYPASS', startedAtMs);

        return { value, cacheStatus: 'BYPASS' };
    }

    const value = await load();

    try {
        await redis.set(cacheKey, JSON.stringify(value), 'EX', policy.ttlSeconds);
    } catch (error) {
        // The value is correct, only not cached: the next request loads it again.
        recordPolicyError(policy, error);
    }

    record(policy, 'MISS', startedAtMs);

    return { value, cacheStatus: 'MISS' };
}

// After a write has committed (never inside its transaction: a reader could re-cache the old data before the
// commit). Never throws: the change is saved, so failing the request would be wrong. If Redis can't be reached,
// entries from before can be served until their TTL — the known gap of a cache that degrades.
export async function invalidateProjectCaches(policies: readonly CachePolicy[], projectIds: readonly number[]): Promise<void> {
    if (!redis || projectIds.length === 0) {
        return;
    }

    try {
        const pipeline = redis.pipeline();
        policies.forEach((policy) => projectIds.forEach((projectId) => {
            pipeline.set(versionKey(policy, projectId), newVersion(), 'EX', VERSION_TTL_SECONDS);
        }));
        throwIfFailed(await pipeline.exec());
    } catch (error) {
        policies.forEach((policy) => recordPolicyError(policy, error));
    }
}

// A write to one project's data: its transaction, then — committed — the project's entries in `policies` are
// invalidated. The one way services write cached data, so the invalidation can't be forgotten or run too early.
export async function withProjectWrite<T>(
    projectId: number,
    policies: readonly CachePolicy[],
    work: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withTransaction(work);

    await invalidateProjectCaches(policies, [projectId]);

    return result;
}

// Server start and test setup. Resolves either way: an unreachable Redis is reported, not fatal.
export async function connectCache(): Promise<'disabled' | 'connected' | 'unreachable'> {
    if (!redis) {
        return 'disabled';
    }

    try {
        await redis.connect();

        return 'connected';
    } catch (error) {
        recordError(error);

        return 'unreachable';
    }
}

export async function closeCache(): Promise<void> {
    if (redis?.status === 'ready') {
        await redis.quit();
    } else {
        redis?.disconnect();
    }
}

export function getCacheMetrics(): CacheMetricsSnapshot {
    return {
        isEnabled: redis !== null,
        redisStatus: redis?.status ?? 'disabled',
        since: countersStartedAt,
        lastError,
        caches: Object.values(CACHE_POLICY).map((policy) => ({ ...policy, ...countersOf(policy) })),
    };
}
