import { toTestExecutionSummaryResponseDto } from '../test-execution/test-execution.mapper.js';
import type { ExecutionProgressRow, TestExecutionRow } from '../test-execution/test-execution.repository.js';
import { toUserReferenceResponseDto } from '../user/user.mapper.js';
import type { SuiteRunRow } from './suite-run.repository.js';
import type { SuiteRunDetailsResponseDto, SuiteRunSummaryResponseDto } from './suite-run.response.dto.js';

// A run whose executions were all removed (their test cases deleted while pending) has no progress row.
const NO_PROGRESS: ExecutionProgressRow = { total: 0, pending: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 };

// The only place suite run rows become API responses.
export function toSuiteRunSummaryResponseDto(row: SuiteRunRow, progress: ExecutionProgressRow | undefined): SuiteRunSummaryResponseDto {
    return {
        id: row.id,
        projectId: row.project_id,
        suiteId: row.test_suite_id,
        suiteName: row.suite_name,
        createdBy: toUserReferenceResponseDto(row.creator_id, row.creator_first_name, row.creator_last_name),
        createdAt: row.created_at.toISOString(),
        progress: progress ?? NO_PROGRESS,
    };
}

export function toSuiteRunDetailsResponseDto(
    row: SuiteRunRow,
    progress: ExecutionProgressRow | undefined,
    executions: TestExecutionRow[],
): SuiteRunDetailsResponseDto {
    return {
        ...toSuiteRunSummaryResponseDto(row, progress),
        executions: executions.map(toTestExecutionSummaryResponseDto),
    };
}
