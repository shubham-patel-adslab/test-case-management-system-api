import { CACHE_POLICY, readThrough, withProjectWrite, type Cached } from '../../app/cache.js';
import { isUniqueViolation, type Queryable } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { toPageResponseDto } from '../../shared/response/page.response.dto.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { projectService } from '../project/project.service.js';
import { testCaseService } from '../test-case/test-case.service.js';
import { toTestSuiteDetailsResponseDto, toTestSuiteSummaryResponseDto } from './test-suite.mapper.js';
import { TEST_SUITE_NAME_UNIQUE_INDEX, testSuiteRepository } from './test-suite.repository.js';
import type {
    TestSuiteCasesAddRequestDto,
    TestSuiteCasesReorderRequestDto,
    TestSuiteCreateRequestDto,
    TestSuitePageRequestDto,
    TestSuiteUpdateRequestDto,
} from './test-suite.request.dto.js';
import type { TestSuiteDetailsResponseDto, TestSuitePageResponseDto } from './test-suite.response.dto.js';

// Suite writes change the project's suite list (names, test case counts).
const SUITE_LIST_CACHES = [CACHE_POLICY.TEST_SUITE_LIST];

const NAME_TAKEN_MESSAGE = 'The project already has a test suite with this name';

function testSuiteNotFound(): AppError {
    return new AppError(404, ERROR_CODE.NOT_FOUND, 'Test suite not found');
}

function nameTaken(cause?: unknown): AppError {
    return new AppError(409, ERROR_CODE.CONFLICT, NAME_TAKEN_MESSAGE, {
        details: [{ field: 'name', message: NAME_TAKEN_MESSAGE }],
        cause,
    });
}

// Every change to a suite's content runs after this: 404 unless the suite is in the project, and the suite
// row stays locked until the transaction ends (see testSuiteRepository.lockIdsInProject).
async function lockSuite(projectId: number, suiteId: number, client: Queryable): Promise<void> {
    const [lockedId] = await testSuiteRepository.lockIdsInProject(projectId, [suiteId], client);

    if (lockedId === undefined) {
        throw testSuiteNotFound();
    }
}

async function getDetails(projectId: number, suiteId: number, db?: Queryable): Promise<TestSuiteDetailsResponseDto> {
    const [row, cases] = await Promise.all([
        testSuiteRepository.selectById(projectId, suiteId, db),
        testSuiteRepository.selectCases(suiteId, db),
    ]);

    if (!row) {
        throw testSuiteNotFound();
    }

    return toTestSuiteDetailsResponseDto(row, cases);
}

// Every operation first checks the project (404 outside the caller's scope); a suite is then only looked up
// within that project. Lock order in writes: project → suite → test cases (same as the test case feature),
// so they can't deadlock with each other.
export const testSuiteService = {
    // Cached 30 minutes (PRD), one entry per page/sort; any suite or test case write in the project invalidates it.
    async getPage(authUser: AuthUser, projectId: number, request: TestSuitePageRequestDto): Promise<Cached<TestSuitePageResponseDto>> {
        await projectService.assertReadable(authUser, projectId);

        return readThrough(CACHE_POLICY.TEST_SUITE_LIST, [projectId], JSON.stringify(request), async () => {
            const offset = (request.page - 1) * request.pageSize;
            const [rows, totalItems] = await Promise.all([
                testSuiteRepository.selectPage(projectId, request.sort, request.pageSize, offset),
                testSuiteRepository.count(projectId),
            ]);

            return toPageResponseDto(rows.map(toTestSuiteSummaryResponseDto), request, totalItems);
        });
    },

    async getById(authUser: AuthUser, projectId: number, suiteId: number): Promise<TestSuiteDetailsResponseDto> {
        await projectService.assertReadable(authUser, projectId);

        return getDetails(projectId, suiteId);
    },

    async create(authUser: AuthUser, projectId: number, request: TestSuiteCreateRequestDto): Promise<TestSuiteDetailsResponseDto> {
        return withProjectWrite(projectId, SUITE_LIST_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            const suiteId = await testSuiteRepository.insert(projectId, request, authUser.id, client);

            if (suiteId === undefined) {
                throw nameTaken();
            }

            return getDetails(projectId, suiteId, client);
        });
    },

    async update(authUser: AuthUser, projectId: number, suiteId: number, request: TestSuiteUpdateRequestDto): Promise<TestSuiteDetailsResponseDto> {
        return withProjectWrite(projectId, SUITE_LIST_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            try {
                if (!(await testSuiteRepository.updateById(projectId, suiteId, request, client))) {
                    throw testSuiteNotFound();
                }
            } catch (error) {
                if (isUniqueViolation(error, TEST_SUITE_NAME_UNIQUE_INDEX)) {
                    throw nameTaken(error);
                }

                throw error;
            }

            return getDetails(projectId, suiteId, client);
        });
    },

    // The suite and its links; never its test cases (PRD / spec rule 7).
    async delete(authUser: AuthUser, projectId: number, suiteId: number): Promise<void> {
        await withProjectWrite(projectId, SUITE_LIST_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            if (!(await testSuiteRepository.deleteById(projectId, suiteId, client))) {
                throw testSuiteNotFound();
            }
        });
    },

    // Appends several test cases in the order given, all-or-nothing: any id that isn't a test case of this
    // project rejects the request (400 on testCaseIds[i]). Cases already in the suite keep their position.
    async addTestCases(authUser: AuthUser, projectId: number, suiteId: number, request: TestSuiteCasesAddRequestDto): Promise<TestSuiteDetailsResponseDto> {
        return withProjectWrite(projectId, SUITE_LIST_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);
            await lockSuite(projectId, suiteId, client);
            await testCaseService.lockInProject(projectId, request.testCaseIds, client);

            const links = request.testCaseIds.map((testCaseId) => ({ suiteId, testCaseId }));
            await testSuiteRepository.insertLinks(projectId, links, authUser.id, client);

            return getDetails(projectId, suiteId, client);
        });
    },

    // Only the link goes; the test case stays (PRD / spec rule 6). 404 if it wasn't in the suite.
    async removeTestCase(authUser: AuthUser, projectId: number, suiteId: number, testCaseId: number): Promise<void> {
        await withProjectWrite(projectId, SUITE_LIST_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);
            await lockSuite(projectId, suiteId, client);

            if (!(await testSuiteRepository.deleteLink(suiteId, testCaseId, client))) {
                throw new AppError(404, ERROR_CODE.NOT_FOUND, 'The test case is not in this test suite');
            }
        });
    },

    // The new order must list every test case of the suite exactly once — the suite is locked, so its
    // content can't change between this check and the renumbering.
    async reorderTestCases(authUser: AuthUser, projectId: number, suiteId: number, request: TestSuiteCasesReorderRequestDto): Promise<TestSuiteDetailsResponseDto> {
        return withProjectWrite(projectId, SUITE_LIST_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);
            await lockSuite(projectId, suiteId, client);

            const current = new Set(await testSuiteRepository.selectCaseIds(suiteId, client));
            const isSameSet = request.testCaseIds.length === current.size && request.testCaseIds.every((id) => current.has(id));

            if (!isSameSet) {
                throw new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
                    details: [{ field: 'testCaseIds', message: 'Must list every test case in the suite exactly once' }],
                });
            }

            await testSuiteRepository.reorder(suiteId, request.testCaseIds, client);

            return getDetails(projectId, suiteId, client);
        });
    },
};
