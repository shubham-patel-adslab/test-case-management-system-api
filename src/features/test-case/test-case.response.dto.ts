import { z } from 'zod';

import { createPageResponseSchema, type PageResponseDto } from '../../shared/response/page.response.dto.js';
import { EXECUTION_RESULTS } from '../test-execution/test-execution.constant.js';
import { TEST_CASE_PRIORITIES, TEST_CASE_TYPES } from './test-case.constant.js';

export const testStepResponseSchema = z
    .object({
        id: z.number().int(),
        // 1-based position in the test case.
        order: z.number().int(),
        action: z.string(),
        expectedResult: z.string(),
    })
    .meta({ id: 'TestStepResponse' });

// One row of the test case list: everything but the steps, which only the details page shows (a page of 100
// test cases × up to 100 steps would be a large response for a table).
export const testCaseSummaryResponseSchema = z
    .object({
        id: z.number().int(),
        projectId: z.number().int(),
        title: z.string(),
        description: z.string(),
        priority: z.enum(TEST_CASE_PRIORITIES),
        type: z.enum(TEST_CASE_TYPES),
        preConditions: z.string(),
        postConditions: z.string(),
        tags: z.array(z.string()),
        // Suites of the same project this test case is in, ascending.
        suiteIds: z.array(z.number().int()),
        // The latest recorded execution result and its time; null until the test case is first executed.
        lastResult: z.enum(EXECUTION_RESULTS).nullable(),
        lastExecutedAt: z.iso.datetime().nullable(),
        // The creator's user id; null once that user row is removed.
        createdBy: z.uuid().nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .meta({ id: 'TestCaseSummaryResponse' });

export const testCaseDetailsResponseSchema = testCaseSummaryResponseSchema
    .extend({ steps: z.array(testStepResponseSchema) })
    .meta({ id: 'TestCaseDetailsResponse' });

export const testCasePageResponseSchema = createPageResponseSchema(testCaseSummaryResponseSchema)
    .meta({ id: 'TestCasePageResponse' });

// DELETE: test cases deleted. UPDATE_PRIORITY: test cases updated. ASSIGN_TO_SUITE: test cases newly added
// (those already in the suite are skipped and keep their position).
export const testCaseBulkResponseSchema = z
    .object({ affectedCount: z.number().int() })
    .meta({ id: 'TestCaseBulkResponse' });

export type TestCaseBulkResponseDto = z.infer<typeof testCaseBulkResponseSchema>;
export type TestStepResponseDto = z.infer<typeof testStepResponseSchema>;
export type TestCaseSummaryResponseDto = z.infer<typeof testCaseSummaryResponseSchema>;
export type TestCaseDetailsResponseDto = z.infer<typeof testCaseDetailsResponseSchema>;
export type TestCasePageResponseDto = PageResponseDto<TestCaseSummaryResponseDto>;
