import { z } from 'zod';

import { TEST_CASE_PRIORITIES, TEST_CASE_TYPES } from '../test-case/test-case.constant.js';
import { userReferenceResponseSchema } from '../user/user.response.dto.js';

const count = () => z.number().int().nonnegative();

// Results recorded in the range, one count per result.
const resultCountsSchema = z.object({
    passed: count(),
    failed: count(),
    blocked: count(),
    skipped: count(),
});

// Results recorded in the range plus the current backlog (pending executions, whenever they were created).
const executionCountsSchema = resultCountsSchema.extend({ pending: count() });

// Counts only: ratios (pass rate, coverage %, defect density) are computed by the client (decided 2026-11-18).
export const analyticsResponseSchema = z
    .object({
        generatedAt: z.iso.datetime(),
        range: z.object({ from: z.iso.date(), to: z.iso.date(), timeZone: z.string() }),
        // null = every project the caller may read.
        projectId: z.number().int().nullable(),
        summary: executionCountsSchema.extend({ total: count() }),
        // Test cases that exist now, and how many of them have a result recorded in the range.
        coverage: z.object({ totalCases: count(), executedCases: count() }),
        // Every day of the range, oldest first, days without results included (zeros).
        trend: z.array(resultCountsSchema.extend({ date: z.iso.date() })),
        // Every priority (LOW → CRITICAL) and type, zeros included, by the test case's current priority/type.
        // Executions of deleted test cases count in the summary but not here.
        byPriority: z.array(executionCountsSchema.extend({ priority: z.enum(TEST_CASE_PRIORITIES) })),
        byType: z.array(executionCountsSchema.extend({ type: z.enum(TEST_CASE_TYPES) })),
        // Everyone with pending work assigned or results recorded in the range, by name. `executed` = results
        // they recorded (passed + failed + blocked + skipped); `pending` = assigned to them, not run yet.
        byTester: z.array(
            resultCountsSchema.extend({ user: userReferenceResponseSchema, pending: count(), executed: count() }),
        ),
        // Defects raised in the range.
        defects: z.object({ total: count() }),
    })
    .meta({ id: 'AnalyticsResponse' });

export type AnalyticsResponseDto = z.infer<typeof analyticsResponseSchema>;
