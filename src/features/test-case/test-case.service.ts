import { CACHE_POLICY, withProjectWrite } from '../../app/cache.js';
import type { Queryable } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { toPageResponseDto } from '../../shared/response/page.response.dto.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { authorizationService } from '../authorization/authorization.service.js';
import { projectService } from '../project/project.service.js';
import { testExecutionRepository } from '../test-execution/test-execution.repository.js';
import { testSuiteRepository } from '../test-suite/test-suite.repository.js';
import { TEST_CASE_BULK_ACTION } from './test-case.constant.js';
import { toTestCaseDetailsResponseDto, toTestCaseSummaryResponseDto } from './test-case.mapper.js';
import { testCaseRepository, type TestCaseRow } from './test-case.repository.js';
import type {
    TestCaseBulkRequestDto,
    TestCaseCreateRequestDto,
    TestCasePageRequestDto,
    TestCaseUpdateRequestDto,
} from './test-case.request.dto.js';
import type {
    TestCaseBulkResponseDto,
    TestCaseDetailsResponseDto,
    TestCasePageResponseDto,
} from './test-case.response.dto.js';

// Test case writes change the dashboard (coverage, by priority/type) and the suites' test case counts.
const TEST_CASE_CACHES = [CACHE_POLICY.ANALYTICS, CACHE_POLICY.TEST_SUITE_LIST];

function testCaseNotFound(): AppError {
    return new AppError(404, ERROR_CODE.NOT_FOUND, 'Test case not found');
}

function validationError(details: { field: string; message: string }[]): AppError {
    return new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', { details });
}

// Locks the requested suites (see testSuiteRepository.lockIdsInProject) and rejects any that isn't a suite
// of this project, as a 400 on the exact suiteIds[i]. Runs before any write, so a bad id changes nothing.
async function lockSuites(projectId: number, suiteIds: number[], client: Queryable): Promise<void> {
    const found = new Set(await testSuiteRepository.lockIdsInProject(projectId, suiteIds, client));
    const details = suiteIds.flatMap((suiteId, index) =>
        found.has(suiteId) ? [] : [{ field: `suiteIds[${index}]`, message: 'Unknown test suite in this project' }],
    );

    if (details.length > 0) {
        throw validationError(details);
    }
}



// Makes the test case's suites exactly `suiteIds`: leaves the others (the test case stays), joins the new
// ones at the end. Suites it stays in keep its position.
async function setSuites(projectId: number, testCaseId: number, suiteIds: number[], actor: AuthUser, client: Queryable): Promise<void> {
    await testSuiteRepository.deleteLinksOfCaseExcept(testCaseId, suiteIds, client);
    await testSuiteRepository.insertLinks(projectId, suiteIds.map((suiteId) => ({ suiteId, testCaseId })), actor.id, client);
}

async function toDetails(row: TestCaseRow, db?: Queryable): Promise<TestCaseDetailsResponseDto> {
    const [steps, suiteIdsByCase] = await Promise.all([
        testCaseRepository.selectSteps(row.id, db),
        testSuiteRepository.selectSuiteIdsByCase([row.id], db),
    ]);

    return toTestCaseDetailsResponseDto(row, steps, suiteIdsByCase.get(row.id) ?? []);
}

// Every operation first checks the project (404 outside the caller's scope); a test case is then only
// looked up within that project, so an id from another project is a 404 too.
export const testCaseService = {
    // For writes on a selection of test cases (bulk, adding to a suite): locks them and rejects the whole
    // request, as a 400 on each bad testCaseIds[i], unless every one is a test case of this project.
    async lockInProject(projectId: number, testCaseIds: number[], client: Queryable): Promise<void> {
        const found = new Set(await testCaseRepository.lockIdsInProject(projectId, testCaseIds, client));
        const details = testCaseIds.flatMap((testCaseId, index) =>
            found.has(testCaseId) ? [] : [{ field: `testCaseIds[${index}]`, message: 'Unknown test case in this project' }],
        );

        if (details.length > 0) {
            throw validationError(details);
        }
    },

    async getPage(authUser: AuthUser, projectId: number, request: TestCasePageRequestDto): Promise<TestCasePageResponseDto> {
        await projectService.assertReadable(authUser, projectId);

        const filter = {
            search: request.search,
            priorities: request.priority,
            types: request.type,
            tags: request.tags,
            suiteId: request.suiteId,
            lastResults: request.lastResult,
        };
        const offset = (request.page - 1) * request.pageSize;

        const [rows, totalItems] = await Promise.all([
            testCaseRepository.selectPage(projectId, filter, request.sort, request.pageSize, offset),
            testCaseRepository.count(projectId, filter),
        ]);

        // Three queries per page, however many test cases it holds.
        const suiteIdsByCase = await testSuiteRepository.selectSuiteIdsByCase(rows.map((row) => row.id));
        const items = rows.map((row) => toTestCaseSummaryResponseDto(row, suiteIdsByCase.get(row.id) ?? []));

        return toPageResponseDto(items, request, totalItems);
    },

    async getById(authUser: AuthUser, projectId: number, testCaseId: number): Promise<TestCaseDetailsResponseDto> {
        await projectService.assertReadable(authUser, projectId);

        const row = await testCaseRepository.selectById(projectId, testCaseId);

        if (!row) {
            throw testCaseNotFound();
        }

        return toDetails(row);
    },

    // The test case, its steps and its suite memberships in one transaction: a bad suite id leaves nothing
    // half-created.
    async create(authUser: AuthUser, projectId: number, request: TestCaseCreateRequestDto): Promise<TestCaseDetailsResponseDto> {
        return withProjectWrite(projectId, TEST_CASE_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);
            await lockSuites(projectId, request.suiteIds, client);

            const row = await testCaseRepository.insert(projectId, request, authUser.id, client);

            await testCaseRepository.replaceSteps(row.id, request.steps, client);
            await setSuites(projectId, row.id, request.suiteIds, authUser, client);

            return toDetails(row, client);
        });
    },

    // Full replacement, steps and suites included.
    async update(authUser: AuthUser, projectId: number, testCaseId: number, request: TestCaseUpdateRequestDto): Promise<TestCaseDetailsResponseDto> {
        return withProjectWrite(projectId, TEST_CASE_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);
            await lockSuites(projectId, request.suiteIds, client);

            const row = await testCaseRepository.updateById(projectId, testCaseId, request, client);

            if (!row) {
                throw testCaseNotFound();
            }

            await testCaseRepository.replaceSteps(row.id, request.steps, client);
            await setSuites(projectId, row.id, request.suiteIds, authUser, client);

            return toDetails(row, client);
        });
    },

    // PRD bulk operations, all-or-nothing in one transaction. The route requires TEST_CASE UPDATE; deleting
    // also needs TEST_CASE DELETE, which depends on the body, so it's checked here. Lock order matches the
    // single-case writes (project → suite → test cases), so they can't deadlock with each other.
    async bulk(authUser: AuthUser, projectId: number, request: TestCaseBulkRequestDto): Promise<TestCaseBulkResponseDto> {
        if (request.action === TEST_CASE_BULK_ACTION.DELETE) {
            await authorizationService.assertPermission(authUser.id, RESOURCE_CODE.TEST_CASE, PERMISSION_CODE.DELETE);
        }

        return withProjectWrite(projectId, TEST_CASE_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            if (request.action === TEST_CASE_BULK_ACTION.ASSIGN_TO_SUITE) {
                const [suiteId] = await testSuiteRepository.lockIdsInProject(projectId, [request.suiteId], client);

                if (suiteId === undefined) {
                    throw validationError([{ field: 'suiteId', message: 'Unknown test suite in this project' }]);
                }
            }

            await testCaseService.lockInProject(projectId, request.testCaseIds, client);

            switch (request.action) {
                case TEST_CASE_BULK_ACTION.DELETE:
                    await testExecutionRepository.deletePendingOfCases(projectId, request.testCaseIds, client);

                    return { affectedCount: await testCaseRepository.deleteByIds(projectId, request.testCaseIds, client) };

                case TEST_CASE_BULK_ACTION.UPDATE_PRIORITY:
                    return {
                        affectedCount: await testCaseRepository.updatePriorityByIds(projectId, request.testCaseIds, request.priority, client),
                    };

                case TEST_CASE_BULK_ACTION.ASSIGN_TO_SUITE: {
                    const links = request.testCaseIds.map((testCaseId) => ({ suiteId: request.suiteId, testCaseId }));

                    return { affectedCount: await testSuiteRepository.insertLinks(projectId, links, authUser.id, client) };
                }
            }
        });
    },

    // Really deletes (PRD; no status — api-requirements §9). Steps and suite memberships go with it; suites
    // stay. Its pending executions go too (nothing happened yet); recorded ones stay with their snapshot. The
    // test case is locked first, so an assignment can't add a pending execution between the two deletes (lock
    // order: test case → executions, as everywhere).
    async delete(authUser: AuthUser, projectId: number, testCaseId: number): Promise<void> {
        await withProjectWrite(projectId, TEST_CASE_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            if ((await testCaseRepository.lockIdsInProject(projectId, [testCaseId], client)).length === 0) {
                throw testCaseNotFound();
            }

            await testExecutionRepository.deletePendingOfCases(projectId, [testCaseId], client);
            await testCaseRepository.deleteById(projectId, testCaseId, client);
        });
    },
};
