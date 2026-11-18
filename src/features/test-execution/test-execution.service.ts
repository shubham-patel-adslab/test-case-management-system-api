import { CACHE_POLICY, withProjectWrite } from '../../app/cache.js';
import type { Queryable } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { toPageResponseDto } from '../../shared/response/page.response.dto.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { authorizationService } from '../authorization/authorization.service.js';
import { attachmentRepository } from '../attachment/attachment.repository.js';
import { defectRepository } from '../defect/defect.repository.js';
import { projectService } from '../project/project.service.js';
import { testCaseRepository, type TestCaseRow, type TestStepRow } from '../test-case/test-case.repository.js';
import { testCaseService } from '../test-case/test-case.service.js';
import { USER_STATUS } from '../user/user.constant.js';
import { userRepository } from '../user/user.repository.js';
import { EXECUTION_AUDIT_ACTION, EXECUTION_STATUS } from './test-execution.constant.js';
import {
    toPendingStepResponseDto,
    toRecordedStepResponseDto,
    toTestExecutionAuditLogResponseDto,
    toTestExecutionDetailsResponseDto,
    toTestExecutionSummaryResponseDto,
} from './test-execution.mapper.js';
import { testExecutionRepository, type ExecutionStepSnapshot } from './test-execution.repository.js';
import type {
    TestExecutionAssignRequestDto,
    TestExecutionCreateRequestDto,
    TestExecutionPageRequestDto,
    TestExecutionProgressRequestDto,
    TestExecutionResultRequestDto,
} from './test-execution.request.dto.js';
import type {
    TestExecutionAssignResponseDto,
    TestExecutionAuditLogResponseDto,
    TestExecutionDetailsResponseDto,
    TestExecutionPageResponseDto,
    TestExecutionProgressResponseDto,
} from './test-execution.response.dto.js';

// Execution writes change the dashboard.
const EXECUTION_CACHES = [CACHE_POLICY.ANALYTICS];

function executionNotFound(): AppError {
    return new AppError(404, ERROR_CODE.NOT_FOUND, 'Test execution not found');
}

function validationError(details: { field: string; message: string }[]): AppError {
    return new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', { details });
}

function alreadyRecorded(): AppError {
    return new AppError(409, ERROR_CODE.CONFLICT, 'This execution\'s result is already recorded. Run the test case again for a new result.');
}

// The steps as run: the test case's steps, each with its optional result. Rejects a result for a step that
// doesn't exist (400 on stepResults[i].order) and an overall PASS when a step failed (400 on status).
function toStepSnapshot(steps: TestStepRow[], request: TestExecutionResultRequestDto): ExecutionStepSnapshot[] {
    const unknownOrders = request.stepResults.flatMap((result, index) =>
        result.order <= steps.length ? [] : [{ field: `stepResults[${index}].order`, message: 'No step with this order' }],
    );

    if (unknownOrders.length > 0) {
        throw validationError(unknownOrders);
    }

    if (request.status === EXECUTION_STATUS.PASS && request.stepResults.some((result) => result.status === EXECUTION_STATUS.FAIL)) {
        throw validationError([{ field: 'status', message: 'Cannot be PASS when a step failed' }]);
    }

    const resultsByOrder = new Map(request.stepResults.map((result) => [result.order, result]));

    return steps.map((step) => ({
        order: step.step_order,
        action: step.action,
        expectedResult: step.expected_result,
        status: resultsByOrder.get(step.step_order)?.status ?? null,
        comment: resultsByOrder.get(step.step_order)?.comment ?? '',
    }));
}

// Everything that goes with a recorded result, in the caller's transaction: the step snapshot, the test case's
// latest result, the audit entry.
async function completeRecording(
    executionId: number,
    testCase: TestCaseRow,
    snapshot: ExecutionStepSnapshot[],
    request: TestExecutionResultRequestDto,
    actor: AuthUser,
    client: Queryable,
): Promise<void> {
    await testExecutionRepository.insertSteps(executionId, snapshot, client);
    await testCaseRepository.updateLastResult(testCase.id, request.status, client);
    await testExecutionRepository.insertAuditLogs([executionId], EXECUTION_AUDIT_ACTION.RESULT_RECORDED, actor.id, { status: request.status }, client);
}

async function getDetails(projectId: number, executionId: number, db?: Queryable): Promise<TestExecutionDetailsResponseDto> {
    const row = await testExecutionRepository.selectById(projectId, executionId, db);

    if (!row) {
        throw executionNotFound();
    }

    // Pending: what the tester is about to run (the test case's current steps). Recorded: the snapshot.
    const steps = row.status === EXECUTION_STATUS.PENDING && row.test_case_id !== null
        ? (await testCaseRepository.selectSteps(row.test_case_id, db)).map(toPendingStepResponseDto)
        : (await testExecutionRepository.selectSteps(row.id, db)).map(toRecordedStepResponseDto);

    const [defect, attachments] = await Promise.all([
        row.defect_id === null ? undefined : defectRepository.selectByExecution(row.id, db),
        attachmentRepository.selectByExecution(row.id, db),
    ]);

    return toTestExecutionDetailsResponseDto(row, steps, defect, attachments);
}

// Every operation first checks the project (404 outside the caller's scope); executions are then only looked
// up within that project. Lock order in writes: project → test cases → executions, as in the test case
// feature (whose deletes remove pending executions), so they can't deadlock with each other.
export const testExecutionService = {
    // Work can be assigned only to an active user who may execute tests (TEST_EXECUTION UPDATE) on this
    // project — never to a read-only user or to someone outside the project. 400 on `assigneeId`. Also used by
    // suite runs.
    async assertAssignable(assigneeId: string, projectId: number): Promise<void> {
        const assignee = await userRepository.selectAuthStateById(assigneeId);
        const isAssignable = assignee?.status === USER_STATUS.ACTIVE
            && (await authorizationService.hasPermission(assigneeId, RESOURCE_CODE.TEST_EXECUTION, PERMISSION_CODE.UPDATE))
            && (await projectService.canAccess(assigneeId, projectId, PERMISSION_CODE.READ));

        if (!isAssignable) {
            throw validationError([{ field: 'assigneeId', message: 'Must be an active member of the project who can execute tests' }]);
        }
    },

    async getPage(authUser: AuthUser, projectId: number, request: TestExecutionPageRequestDto): Promise<TestExecutionPageResponseDto> {
        await projectService.assertReadable(authUser, projectId);

        const filter = {
            statuses: request.status,
            assigneeId: request.assigneeId,
            testCaseId: request.testCaseId,
            suiteRunId: request.suiteRunId,
        };
        const offset = (request.page - 1) * request.pageSize;

        const [rows, totalItems] = await Promise.all([
            testExecutionRepository.selectPage(projectId, filter, request.sort, request.pageSize, offset),
            testExecutionRepository.count(projectId, filter),
        ]);

        return toPageResponseDto(rows.map(toTestExecutionSummaryResponseDto), request, totalItems);
    },

    async getProgress(authUser: AuthUser, projectId: number, request: TestExecutionProgressRequestDto): Promise<TestExecutionProgressResponseDto> {
        await projectService.assertReadable(authUser, projectId);

        return testExecutionRepository.selectProgress(projectId, request.assigneeId);
    },

    async getById(authUser: AuthUser, projectId: number, executionId: number): Promise<TestExecutionDetailsResponseDto> {
        await projectService.assertReadable(authUser, projectId);

        return getDetails(projectId, executionId);
    },

    async getAuditLogs(authUser: AuthUser, projectId: number, executionId: number): Promise<TestExecutionAuditLogResponseDto[]> {
        await projectService.assertReadable(authUser, projectId);

        if (!(await testExecutionRepository.selectById(projectId, executionId))) {
            throw executionNotFound();
        }

        return (await testExecutionRepository.selectAuditLogs(executionId)).map(toTestExecutionAuditLogResponseDto);
    },

    // PRD "Assign test cases to testers": one PENDING execution per test case, all-or-nothing (any id not in
    // the project → 400 on testCaseIds[i]). Cases already pending for this assignee are skipped.
    async assign(authUser: AuthUser, projectId: number, request: TestExecutionAssignRequestDto): Promise<TestExecutionAssignResponseDto> {
        return withProjectWrite(projectId, EXECUTION_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);
            await testExecutionService.assertAssignable(request.assigneeId, projectId);
            await testCaseService.lockInProject(projectId, request.testCaseIds, client);

            const executionIds = await testExecutionRepository.insertPendingForCases(projectId, request.testCaseIds, request.assigneeId, authUser.id, client);

            if (executionIds.length > 0) {
                await testExecutionRepository.insertAuditLogs(
                    executionIds,
                    EXECUTION_AUDIT_ACTION.CREATED,
                    authUser.id,
                    { assigneeId: request.assigneeId },
                    client,
                );
            }

            return { createdCount: executionIds.length };
        });
    },

    // Run a test case ad hoc: the execution is created with its result, title and steps snapshotted.
    async create(authUser: AuthUser, projectId: number, request: TestExecutionCreateRequestDto): Promise<TestExecutionDetailsResponseDto> {
        return withProjectWrite(projectId, EXECUTION_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            const testCase = await testCaseRepository.selectById(projectId, request.testCaseId, client, true);

            if (!testCase) {
                throw validationError([{ field: 'testCaseId', message: 'Unknown test case in this project' }]);
            }

            const snapshot = toStepSnapshot(await testCaseRepository.selectSteps(testCase.id, client), request);
            const executionId = await testExecutionRepository.insertRecorded(projectId, testCase, request, authUser.id, client);

            await completeRecording(executionId, testCase, snapshot, request, authUser, client);

            return getDetails(projectId, executionId, client);
        });
    },

    // Record the result of a PENDING execution — once (results are immutable; 409 afterwards). Any project
    // member who may execute can record it, not only the assignee (PRD §4, decided 2026-11-17).
    async recordResult(authUser: AuthUser, projectId: number, executionId: number, request: TestExecutionResultRequestDto): Promise<TestExecutionDetailsResponseDto> {
        return withProjectWrite(projectId, EXECUTION_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            const execution = await testExecutionRepository.selectById(projectId, executionId, client);

            if (!execution) {
                throw executionNotFound();
            }

            if (execution.status !== EXECUTION_STATUS.PENDING || execution.test_case_id === null) {
                throw alreadyRecorded();
            }

            // Test case before execution (the lock order): locked so title and steps stay stable while they are
            // snapshotted and its last result can be written (see testCaseRepository.selectById). A deleted test
            // case took its pending executions with it.
            const testCase = await testCaseRepository.selectById(projectId, execution.test_case_id, client, true);
            const locked = await testExecutionRepository.lockById(projectId, executionId, client);

            if (!testCase || !locked) {
                throw executionNotFound();
            }

            // Re-checked under the lock: of two people recording at once, the second gets 409.
            if (locked.status !== EXECUTION_STATUS.PENDING) {
                throw alreadyRecorded();
            }

            const snapshot = toStepSnapshot(await testCaseRepository.selectSteps(testCase.id, client), request);

            if (!(await testExecutionRepository.recordResult(executionId, testCase.title, request, authUser.id, client))) {
                throw alreadyRecorded();
            }

            await completeRecording(executionId, testCase, snapshot, request, authUser, client);

            return getDetails(projectId, executionId, client);
        });
    },
};
