import { withTransaction, type Queryable } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { toPageResponseDto } from '../../shared/response/page.response.dto.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { authorizationService } from '../authorization/authorization.service.js';
import { projectService } from '../project/project.service.js';
import { testCaseRepository } from '../test-case/test-case.repository.js';
import { EXECUTION_AUDIT_ACTION } from '../test-execution/test-execution.constant.js';
import { testExecutionRepository } from '../test-execution/test-execution.repository.js';
import { testExecutionService } from '../test-execution/test-execution.service.js';
import { testSuiteRepository } from '../test-suite/test-suite.repository.js';
import { toSuiteRunDetailsResponseDto, toSuiteRunSummaryResponseDto } from './suite-run.mapper.js';
import { suiteRunRepository } from './suite-run.repository.js';
import type { SuiteRunCreateRequestDto, SuiteRunPageRequestDto } from './suite-run.request.dto.js';
import type { SuiteRunDetailsResponseDto, SuiteRunPageResponseDto } from './suite-run.response.dto.js';

function testSuiteNotFound(): AppError {
    return new AppError(404, ERROR_CODE.NOT_FOUND, 'Test suite not found');
}

function suiteRunNotFound(): AppError {
    return new AppError(404, ERROR_CODE.NOT_FOUND, 'Suite run not found');
}

async function getDetails(projectId: number, runId: number, db?: Queryable): Promise<SuiteRunDetailsResponseDto> {
    const row = await suiteRunRepository.selectById(projectId, runId, db);

    if (!row) {
        throw suiteRunNotFound();
    }

    const [progressByRun, executions] = await Promise.all([
        testExecutionRepository.selectProgressByRun([runId], db),
        testExecutionRepository.selectByRun(runId, db),
    ]);

    return toSuiteRunDetailsResponseDto(row, progressByRun.get(runId), executions);
}

// PRD Features §6 "Execute entire test suites" and "Suite-level reporting". A run's executions are ordinary
// executions (recorded with PUT …/test-executions/:executionId); the run groups them and reports on them.
export const suiteRunService = {
    // One PENDING execution per test case of the suite, in suite order. Lock order: project → suite → test
    // cases → executions (as everywhere), so a concurrent test case delete either finishes first (that case is
    // left out) or waits for the run.
    async create(authUser: AuthUser, projectId: number, suiteId: number, request: SuiteRunCreateRequestDto): Promise<SuiteRunDetailsResponseDto> {
        const { assigneeId } = request;

        // Running a suite for yourself is executing; giving the work to someone else is assigning.
        if (assigneeId !== undefined && assigneeId !== authUser.id) {
            await authorizationService.assertPermission(authUser.id, RESOURCE_CODE.TEST_ASSIGNMENT, PERMISSION_CODE.CREATE);
        }

        return withTransaction(async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            if (assigneeId !== undefined) {
                await testExecutionService.assertAssignable(assigneeId, projectId);
            }

            const [lockedSuiteId] = await testSuiteRepository.lockIdsInProject(projectId, [suiteId], client);
            const suite = lockedSuiteId === undefined ? undefined : await testSuiteRepository.selectById(projectId, suiteId, client);

            if (!suite) {
                throw testSuiteNotFound();
            }

            const suiteCaseIds = (await testSuiteRepository.selectCases(suiteId, client)).map((testCase) => testCase.id);
            const lockedCaseIds = new Set(await testCaseRepository.lockIdsInProject(projectId, suiteCaseIds, client));
            const testCaseIds = suiteCaseIds.filter((id) => lockedCaseIds.has(id));

            if (testCaseIds.length === 0) {
                throw new AppError(409, ERROR_CODE.CONFLICT, 'The test suite has no test cases to run');
            }

            const runId = await suiteRunRepository.insert(projectId, suite, authUser.id, client);
            const executionIds = await testExecutionRepository.insertPendingForRun(projectId, runId, testCaseIds, assigneeId ?? null, authUser.id, client);

            await testExecutionRepository.insertAuditLogs(
                executionIds,
                EXECUTION_AUDIT_ACTION.CREATED,
                authUser.id,
                { suiteRunId: runId, assigneeId: assigneeId ?? null },
                client,
            );

            return getDetails(projectId, runId, client);
        });
    },

    async getById(authUser: AuthUser, projectId: number, runId: number): Promise<SuiteRunDetailsResponseDto> {
        await projectService.assertReadable(authUser, projectId);

        return getDetails(projectId, runId);
    },

    // A suite's runs, newest first, each with its progress — two queries per page plus one for all progress.
    async getPageBySuite(authUser: AuthUser, projectId: number, suiteId: number, request: SuiteRunPageRequestDto): Promise<SuiteRunPageResponseDto> {
        await projectService.assertReadable(authUser, projectId);

        if (!(await testSuiteRepository.selectById(projectId, suiteId))) {
            throw testSuiteNotFound();
        }

        const offset = (request.page - 1) * request.pageSize;
        const [rows, totalItems] = await Promise.all([
            suiteRunRepository.selectPageBySuite(projectId, suiteId, request.pageSize, offset),
            suiteRunRepository.countBySuite(projectId, suiteId),
        ]);
        const progressByRun = await testExecutionRepository.selectProgressByRun(rows.map((row) => row.id));

        return toPageResponseDto(rows.map((row) => toSuiteRunSummaryResponseDto(row, progressByRun.get(row.id))), request, totalItems);
    },
};
