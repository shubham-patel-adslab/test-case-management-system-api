import type { TestCaseRow, TestStepRow } from './test-case.repository.js';
import type {
    TestCaseDetailsResponseDto,
    TestCaseSummaryResponseDto,
    TestStepResponseDto,
} from './test-case.response.dto.js';

// The only place test case rows become API responses: snake_case → camelCase, Date → ISO string.
export function toTestCaseSummaryResponseDto(row: TestCaseRow, suiteIds: number[]): TestCaseSummaryResponseDto {
    return {
        id: row.id,
        projectId: row.project_id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        type: row.type,
        preConditions: row.pre_conditions,
        postConditions: row.post_conditions,
        tags: row.tags,
        suiteIds,
        lastResult: row.last_result,
        lastExecutedAt: row.last_executed_at?.toISOString() ?? null,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

function toTestStepResponseDto(row: TestStepRow): TestStepResponseDto {
    return {
        id: row.id,
        order: row.step_order,
        action: row.action,
        expectedResult: row.expected_result,
    };
}

export function toTestCaseDetailsResponseDto(row: TestCaseRow, steps: TestStepRow[], suiteIds: number[]): TestCaseDetailsResponseDto {
    return {
        ...toTestCaseSummaryResponseDto(row, suiteIds),
        steps: steps.map(toTestStepResponseDto),
    };
}
