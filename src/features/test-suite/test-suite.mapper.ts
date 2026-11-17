import type { TestSuiteCaseRow, TestSuiteRow } from './test-suite.repository.js';
import type {
    TestSuiteCaseResponseDto,
    TestSuiteDetailsResponseDto,
    TestSuiteSummaryResponseDto,
} from './test-suite.response.dto.js';

// The only place suite rows become API responses: snake_case → camelCase, Date → ISO string.
export function toTestSuiteSummaryResponseDto(row: TestSuiteRow): TestSuiteSummaryResponseDto {
    return {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        description: row.description,
        testCaseCount: row.test_case_count,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

function toTestSuiteCaseResponseDto(row: TestSuiteCaseRow): TestSuiteCaseResponseDto {
    return {
        id: row.id,
        order: row.position,
        title: row.title,
        priority: row.priority,
        type: row.type,
    };
}

export function toTestSuiteDetailsResponseDto(row: TestSuiteRow, cases: TestSuiteCaseRow[]): TestSuiteDetailsResponseDto {
    return {
        ...toTestSuiteSummaryResponseDto(row),
        testCases: cases.map(toTestSuiteCaseResponseDto),
    };
}
