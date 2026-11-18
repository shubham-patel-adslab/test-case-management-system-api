import { TEST_CASE_PRIORITIES, TEST_CASE_TYPES } from '../test-case/test-case.constant.js';
import type { ExecutionStatus } from '../test-execution/test-execution.constant.js';
import type { AnalyticsRequestDto } from './analytics.request.dto.js';
import type { AnalyticsResponseDto } from './analytics.response.dto.js';
import type { ExecutionBreakdownRow, TesterRow, TotalsRow, TrendRow } from './analytics.repository.js';

type ExecutionCounts = { passed: number; failed: number; blocked: number; skipped: number; pending: number };

const COUNT_KEY_BY_STATUS: Record<ExecutionStatus, keyof ExecutionCounts> = {
    PASS: 'passed',
    FAIL: 'failed',
    BLOCKED: 'blocked',
    SKIPPED: 'skipped',
    PENDING: 'pending',
};

function emptyCounts(): ExecutionCounts {
    return { passed: 0, failed: 0, blocked: 0, skipped: 0, pending: 0 };
}

function countByStatus(rows: ExecutionBreakdownRow[]): ExecutionCounts {
    const counts = emptyCounts();

    for (const row of rows) {
        counts[COUNT_KEY_BY_STATUS[row.status]] += row.count;
    }

    return counts;
}

// One entry per value, zeros included, so a chart's categories don't depend on the data.
function countPer<TValue extends string>(
    values: readonly TValue[],
    rows: ExecutionBreakdownRow[],
    valueOf: (row: ExecutionBreakdownRow) => TValue | null,
): [TValue, ExecutionCounts][] {
    return values.map((value) => [value, countByStatus(rows.filter((row) => valueOf(row) === value))]);
}

export type AnalyticsData = {
    breakdown: ExecutionBreakdownRow[];
    trend: TrendRow[];
    testers: TesterRow[];
    totals: TotalsRow;
};

export function toAnalyticsResponseDto(data: AnalyticsData, request: AnalyticsRequestDto, generatedAt: Date): AnalyticsResponseDto {
    const summary = countByStatus(data.breakdown);

    return {
        generatedAt: generatedAt.toISOString(),
        range: { from: request.from, to: request.to, timeZone: request.timeZone },
        projectId: request.projectId ?? null,
        summary: {
            ...summary,
            total: summary.passed + summary.failed + summary.blocked + summary.skipped + summary.pending,
        },
        coverage: { totalCases: data.totals.total_cases, executedCases: data.totals.executed_cases },
        trend: data.trend.map(({ date, passed, failed, blocked, skipped }) => ({ date, passed, failed, blocked, skipped })),
        byPriority: countPer(TEST_CASE_PRIORITIES, data.breakdown, (row) => row.priority)
            .map(([priority, counts]) => ({ priority, ...counts })),
        byType: countPer(TEST_CASE_TYPES, data.breakdown, (row) => row.type)
            .map(([type, counts]) => ({ type, ...counts })),
        byTester: data.testers.map((row) => ({
            user: { id: row.id, firstName: row.first_name, lastName: row.last_name },
            pending: row.pending,
            executed: row.executed,
            passed: row.passed,
            failed: row.failed,
            blocked: row.blocked,
            skipped: row.skipped,
        })),
        defects: { total: data.totals.defects },
    };
}
