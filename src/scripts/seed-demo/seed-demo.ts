// Loads the demo data (PRD Live Demo): one active user per role, three sample projects with 400 test cases, suites,
// and 60 days of execution history with defects and a pending backlog, so every page and the dashboard have
// something to show. Usage:
//   DEMO_USER_PASSWORD=… in .env (or the deployment's secret store), then
//   npm run seed:demo                 first time
//   npm run seed:demo -- --reset      replace the demo data (deletes the demo users and every project they created)
// The demo users' password comes from the environment, never from code (anyone who can read the repo would know
// the live demo's logins); the server never reads it. The same seed gives the same data every time, dated from
// today. A CLI's terminal output is its interface, hence console use here.
//
// Users, projects, suites and test cases go through the services, so the same validation and rules apply as for
// the API. Only what the API can't write — past dates — is set with SQL here and in demo-history.ts.
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { CACHE_POLICY, closeCache, connectCache, invalidateProjectCaches } from '../../app/cache.js';
import { pool, withTransaction, type Queryable } from '../../app/database.js';
import { deleteFile } from '../../app/file-storage.js';
import type { AuthUser } from '../../features/authentication/authentication.middleware.js';
import { projectCreateRequestSchema } from '../../features/project/project.request.dto.js';
import { projectService } from '../../features/project/project.service.js';
import { testCaseCreateRequestSchema } from '../../features/test-case/test-case.request.dto.js';
import { testCaseService } from '../../features/test-case/test-case.service.js';
import { testSuiteCreateRequestSchema } from '../../features/test-suite/test-suite.request.dto.js';
import { testSuiteService } from '../../features/test-suite/test-suite.service.js';
import { newPasswordSchema } from '../../features/user/user.request.dto.js';
import { userService } from '../../features/user/user.service.js';
import { AppError } from '../../shared/error/app.error.js';
import {
    buildTestCases,
    DEMO_EMAIL_DOMAIN,
    DEMO_PROJECTS,
    DEMO_USERS,
    REGRESSION_SUITE_NAME,
    SMOKE_SUITE_NAME,
    type DemoProject,
    type DemoUserKey,
} from './demo-catalog.js';
import { insertHistory, type HistoryCounts, type HistoryTestCase } from './demo-history.js';
import { createRandom, type Random } from './demo-random.js';

const RANDOM_SEED = 20_261_118;
const HISTORY_DAYS = 60;
// Projects, suites and test cases exist before the first recorded result.
const PROJECT_AGE_DAYS = 90;
const SUITE_AGE_DAYS = 88;
const TEST_CASE_MIN_AGE_DAYS = HISTORY_DAYS + 2;
const TEST_CASE_AGE_SPREAD_DAYS = 25;

const DEMO_EMAIL_PATTERN = `%@${DEMO_EMAIL_DOMAIN}`;

type DemoUsers = Record<DemoUserKey, AuthUser>;

async function countDemoUsers(): Promise<number> {
    const result = await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users WHERE email LIKE $1', [DEMO_EMAIL_PATTERN]);

    return result.rows[0]?.count ?? 0;
}

// Every demo user and every project a demo user created, with all their data: the same order as the API's own
// deletes need (attachments and defects before executions, executions before suite runs and test cases).
// Attachment files are deleted after the commit, so a rollback can't leave rows pointing at missing files.
async function deleteDemoData(): Promise<void> {
    const demoProjectIds = 'SELECT p.id FROM projects p JOIN users u ON u.id = p.created_by WHERE u.email LIKE $1';
    const storedNames = await withTransaction(async (client) => {
        const attachments = await client.query<{ stored_name: string }>(
            `DELETE FROM attachments a USING test_executions e
              WHERE e.id = a.test_execution_id AND e.project_id IN (${demoProjectIds})
              RETURNING a.stored_name`,
            [DEMO_EMAIL_PATTERN],
        );

        for (const table of ['defects', 'test_executions', 'suite_runs', 'test_suites', 'test_cases']) {
            await client.query(`DELETE FROM ${table} WHERE project_id IN (${demoProjectIds})`, [DEMO_EMAIL_PATTERN]);
        }

        await client.query(`DELETE FROM projects WHERE id IN (${demoProjectIds})`, [DEMO_EMAIL_PATTERN]);
        await client.query('DELETE FROM users WHERE email LIKE $1', [DEMO_EMAIL_PATTERN]);

        return attachments.rows.map((row) => row.stored_name);
    });

    await Promise.all(storedNames.map((storedName) => deleteFile(storedName)));
}

async function createUsers(password: string): Promise<DemoUsers> {
    const users: Partial<DemoUsers> = {};

    for (const { key, ...user } of DEMO_USERS) {
        const created = await userService.createWithPassword({ ...user, password }, null);
        users[key] = { id: created.id };
    }

    const { admin, lead, tester, tester2, readOnly } = users;

    if (!admin || !lead || !tester || !tester2 || !readOnly) {
        throw new Error('A demo user is missing from DEMO_USERS');
    }

    return { admin, lead, tester, tester2, readOnly };
}

// The structure was created just now; dated back so it exists before the history that follows.
async function backdateStructure(projectId: number, db: Queryable): Promise<void> {
    await db.query(
        `UPDATE projects SET created_at = now() - make_interval(days => $2), updated_at = now() - make_interval(days => $2) WHERE id = $1`,
        [projectId, PROJECT_AGE_DAYS],
    );
    await db.query(
        `UPDATE test_suites SET created_at = now() - make_interval(days => $2), updated_at = now() - make_interval(days => $2)
          WHERE project_id = $1`,
        [projectId, SUITE_AGE_DAYS],
    );
    await db.query(
        `UPDATE test_cases
            SET created_at = now() - make_interval(days => $2 + id % $3), updated_at = now() - make_interval(days => $2 + id % $3)
          WHERE project_id = $1`,
        [projectId, TEST_CASE_MIN_AGE_DAYS, TEST_CASE_AGE_SPREAD_DAYS],
    );
}

async function seedProject(project: DemoProject, users: DemoUsers, random: Random, now: Date): Promise<{ testCases: number } & HistoryCounts> {
    const created = await projectService.create(users.admin, projectCreateRequestSchema.parse({
        name: project.name,
        description: project.description,
        version: project.version,
        status: 'ACTIVE',
        memberIds: project.members.map((key) => users[key].id),
    }));

    const createSuite = async (name: string, description: string) => {
        const suite = await testSuiteService.create(users.lead, created.id, testSuiteCreateRequestSchema.parse({ name, description }));

        return suite.id;
    };
    const suiteIdByModule = new Map<string, number>();

    for (const module of project.modules) {
        suiteIdByModule.set(module.name, await createSuite(module.name, `Every ${module.name.toLowerCase()} test case of ${project.name}.`));
    }

    const smokeSuiteId = await createSuite(SMOKE_SUITE_NAME, 'Critical paths, checked before every release.');
    const regressionSuiteId = await createSuite(REGRESSION_SUITE_NAME, 'Critical and high-priority test cases, run every week.');

    const testCases: HistoryTestCase[] = [];
    const regressionCaseIds: number[] = [];

    for (const demoCase of buildTestCases(project, random)) {
        const { moduleName, isSmoke, isRegression, ...fields } = demoCase;
        const moduleSuiteId = suiteIdByModule.get(moduleName);

        if (moduleSuiteId === undefined) {
            throw new Error(`No suite for module ${moduleName}`);
        }

        // Created in order, so each suite's order is the catalog's order.
        const testCase = await testCaseService.create(users.lead, created.id, testCaseCreateRequestSchema.parse({
            ...fields,
            suiteIds: [moduleSuiteId, ...(isSmoke ? [smokeSuiteId] : []), ...(isRegression ? [regressionSuiteId] : [])],
        }));

        testCases.push({ id: testCase.id, title: testCase.title, priority: testCase.priority, steps: testCase.steps });

        if (isRegression) {
            regressionCaseIds.push(testCase.id);
        }
    }

    const counts = await withTransaction(async (client) => {
        await backdateStructure(created.id, client);

        return insertHistory({
            projectId: created.id,
            testCases,
            regressionSuite: { id: regressionSuiteId, name: REGRESSION_SUITE_NAME, testCaseIds: regressionCaseIds },
            executors: project.executors.map(([key, weight]) => [users[key].id, weight] as const),
            leadId: users.lead.id,
            dailyResults: project.dailyResults,
            days: HISTORY_DAYS,
            now,
        }, random, client);
    });

    // The history was written with SQL, past the services: invalidate like they would.
    await invalidateProjectCaches(Object.values(CACHE_POLICY), [created.id]);

    return { testCases: testCases.length, ...counts };
}

async function seedDemo(): Promise<void> {
    const { values } = parseArgs({ options: { reset: { type: 'boolean', default: false } } });
    const password = newPasswordSchema.safeParse(process.env['DEMO_USER_PASSWORD']);

    if (!password.success) {
        throw new Error(`DEMO_USER_PASSWORD is missing or invalid:\n${z.prettifyError(password.error)}`);
    }

    if (await countDemoUsers() > 0) {
        if (!values.reset) {
            throw new Error('Demo data already exists. To replace it, run `npm run seed:demo -- --reset` (deletes every '
                + `@${DEMO_EMAIL_DOMAIN} user and every project they created).`);
        }

        console.info('Deleting the existing demo data…');
        await deleteDemoData();
    }

    // The services invalidate cached data as they write, like through the API.
    await connectCache();

    const random = createRandom(RANDOM_SEED);
    const now = new Date();

    console.info('Creating the demo users…');
    const users = await createUsers(password.data);

    for (const project of DEMO_PROJECTS) {
        console.info(`Seeding ${project.name}…`);
        const counts = await seedProject(project, users, random, now);
        console.info(`  ${counts.testCases} test cases, ${counts.recorded} results, ${counts.pending} pending, `
            + `${counts.defects} defects, ${counts.suiteRuns} suite runs`);
    }

    console.info('\nDemo users (password: the value of DEMO_USER_PASSWORD):');

    for (const user of DEMO_USERS) {
        console.info(`  ${user.roleCode.padEnd(10)} ${user.email}`);
    }
}

try {
    await seedDemo();
} catch (error) {
    // AppError = expected failure (e.g. a rule a service enforces): its message is enough.
    console.error(error instanceof AppError ? `${error.message}.` : error);
    process.exitCode = 1;
} finally {
    await pool.end();
    await closeCache();
}
