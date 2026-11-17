import { toAttachmentResponseDto } from '../attachment/attachment.mapper.js';
import type { AttachmentRow } from '../attachment/attachment.repository.js';
import { toDefectDetailsResponseDto } from '../defect/defect.mapper.js';
import type { DefectRow } from '../defect/defect.repository.js';
import type { TestStepRow } from '../test-case/test-case.repository.js';
import { toUserReferenceResponseDto } from '../user/user.mapper.js';
import type { TestExecutionAuditLogRow, TestExecutionRow, TestExecutionStepRow } from './test-execution.repository.js';
import type {
    TestExecutionAuditLogResponseDto,
    TestExecutionDetailsResponseDto,
    TestExecutionStepResponseDto,
    TestExecutionSummaryResponseDto,
} from './test-execution.response.dto.js';

// The only place execution rows become API responses: snake_case → camelCase, Date → ISO string.
export function toTestExecutionSummaryResponseDto(row: TestExecutionRow): TestExecutionSummaryResponseDto {
    return {
        id: row.id,
        projectId: row.project_id,
        testCaseId: row.test_case_id,
        testCaseTitle: row.test_case_title,
        suiteRunId: row.suite_run_id,
        status: row.status,
        assignee: toUserReferenceResponseDto(row.assignee_id, row.assignee_first_name, row.assignee_last_name),
        executedBy: toUserReferenceResponseDto(row.executor_id, row.executor_first_name, row.executor_last_name),
        executedAt: row.executed_at?.toISOString() ?? null,
        defect: row.defect_id === null || row.defect_title === null || row.defect_severity === null
            ? null
            : { id: row.defect_id, title: row.defect_title, severity: row.defect_severity },
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

export function toRecordedStepResponseDto(row: TestExecutionStepRow): TestExecutionStepResponseDto {
    return {
        order: row.step_order,
        action: row.action,
        expectedResult: row.expected_result,
        status: row.status,
        comment: row.comment,
    };
}

// A pending execution shows the test case's current steps, not yet run.
export function toPendingStepResponseDto(row: TestStepRow): TestExecutionStepResponseDto {
    return {
        order: row.step_order,
        action: row.action,
        expectedResult: row.expected_result,
        status: null,
        comment: '',
    };
}

export function toTestExecutionDetailsResponseDto(
    row: TestExecutionRow,
    steps: TestExecutionStepResponseDto[],
    defect: DefectRow | undefined,
    attachments: AttachmentRow[],
): TestExecutionDetailsResponseDto {
    return {
        ...toTestExecutionSummaryResponseDto(row),
        comment: row.comment,
        steps,
        defect: defect ? toDefectDetailsResponseDto(defect) : null,
        attachments: attachments.map(toAttachmentResponseDto),
    };
}

export function toTestExecutionAuditLogResponseDto(row: TestExecutionAuditLogRow): TestExecutionAuditLogResponseDto {
    return {
        id: row.id,
        action: row.action,
        actor: toUserReferenceResponseDto(row.actor_id, row.actor_first_name, row.actor_last_name),
        details: row.details,
        createdAt: row.created_at.toISOString(),
    };
}
