import { CACHE_POLICY, readThrough, type Cached } from '../../app/cache.js';
import { withSnapshot } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { projectService } from '../project/project.service.js';
import { TIME_ZONE_INVALID_MESSAGE } from './analytics.constant.js';
import { toAnalyticsResponseDto, type AnalyticsData } from './analytics.mapper.js';
import { analyticsRepository, type AnalyticsFilter } from './analytics.repository.js';
import type { AnalyticsRequestDto } from './analytics.request.dto.js';
import type { AnalyticsResponseDto } from './analytics.response.dto.js';
import { TIME_ZONE_ALIASES } from './analytics.time-zone-aliases.js';

// Names compare case-insensitively, as AT TIME ZONE does.
const CURRENT_TIME_ZONE_BY_ALIAS = new Map(
    Object.entries(TIME_ZONE_ALIASES).map(([alias, current]) => [alias.toLowerCase(), current]),
);

// Lowercased name → the name as the database spells it. Loaded on first use and kept: it changes only with the
// database host's tzdata package (restart the API after upgrading it). A failed load isn't kept, the next request
// retries.
let knownTimeZones: Promise<Map<string, string>> | undefined;

function loadKnownTimeZones(): Promise<Map<string, string>> {
    knownTimeZones ??= analyticsRepository.selectTimeZoneNames().then(
        (names) => new Map(names.map((name) => [name.toLowerCase(), name])),
        (error: unknown) => {
            knownTimeZones = undefined;
            throw error;
        },
    );

    return knownTimeZones;
}

// The zone to query with: an old name resolved to its current one (Asia/Calcutta → Asia/Kolkata) — browsers still
// send some, and the database may not have them — then checked against what the database knows, so a name it
// can't use is a 400 here, never a 500 from AT TIME ZONE.
async function resolveTimeZone(name: string): Promise<string> {
    const current = CURRENT_TIME_ZONE_BY_ALIAS.get(name.toLowerCase()) ?? name;
    const known = (await loadKnownTimeZones()).get(current.toLowerCase());

    if (known === undefined) {
        throw new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
            details: [{ field: 'timeZone', message: TIME_ZONE_INVALID_MESSAGE }],
        });
    }

    return known;
}

export const analyticsService = {
    // The dashboard over every project the caller may read (ADMIN: all; others: their own), or one of them.
    // A project outside the scope is a 404, like everywhere else. One snapshot, so the summary, trend and
    // per-tester numbers agree with each other even while results are being recorded.
    //
    // Cached 15 minutes (PRD). The entry depends on every project the dashboard covers, so a write to any of them
    // invalidates it, and a change of team gives a different set of projects — a different entry. Cached: the
    // query results, not the response, so each response echoes its own request (`range.timeZone` as sent; Asia/
    // Calcutta and Asia/Kolkata share one entry).
    async get(authUser: AuthUser, request: AnalyticsRequestDto): Promise<Cached<AnalyticsResponseDto>> {
        // A bad request is a 400 before anything else, as when the schema rejects it.
        const timeZone = await resolveTimeZone(request.timeZone);

        if (request.projectId !== undefined) {
            await projectService.assertReadable(authUser, request.projectId);
        }

        const scope = await projectService.getReadScope(authUser);
        const projectIds = request.projectId === undefined ? await projectService.getIdsInScope(scope) : [request.projectId];
        const filter: AnalyticsFilter = { scope, projectId: request.projectId, from: request.from, to: request.to, timeZone };

        const { value, cacheStatus } = await readThrough(
            CACHE_POLICY.ANALYTICS,
            projectIds,
            JSON.stringify({ from: request.from, to: request.to, timeZone }),
            async () => ({
                // One after another: a transaction is one connection, which runs one query at a time anyway.
                data: await withSnapshot(async (client): Promise<AnalyticsData> => ({
                    breakdown: await analyticsRepository.selectExecutionBreakdown(filter, client),
                    trend: await analyticsRepository.selectTrend(filter, client),
                    testers: await analyticsRepository.selectTesters(filter, client),
                    totals: await analyticsRepository.selectTotals(filter, client),
                })),
                generatedAt: new Date().toISOString(),
            }),
        );

        // generatedAt is when the numbers were computed, so a cached answer says how old it is.
        return { value: toAnalyticsResponseDto(value.data, request, new Date(value.generatedAt)), cacheStatus };
    },
};
