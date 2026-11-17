import { z } from 'zod';

import { idListSchema, idParamSchema, idSchema } from '../../shared/request/id.schema.js';
import { pageRequestSchema } from '../../shared/request/page.request.dto.js';
import { sortSchema, type Sort } from '../../shared/request/sort.schema.js';
import { selectedTestCaseIdsSchema } from '../test-case/test-case.request.dto.js';
import {
    TEST_SUITE_DEFAULT_SORT,
    TEST_SUITE_DESCRIPTION_MAX_LENGTH,
    TEST_SUITE_NAME_MAX_LENGTH,
    TEST_SUITE_REORDER_MAX,
    TEST_SUITE_SORT_FIELDS,
    type TestSuiteSortField,
} from './test-suite.constant.js';

// Same rules as the database constraints. trim() runs first, so a whitespace-only name fails min(1).
// Unknown fields (id on create, projectId, testCaseCount, …) are stripped. The suite's test cases are not
// part of it: they change through the …/test-cases endpoints (or a test case's suiteIds).
const testSuiteFieldsSchema = z.object({
    name: z.string().trim().min(1).max(TEST_SUITE_NAME_MAX_LENGTH),
    description: z.string().trim().max(TEST_SUITE_DESCRIPTION_MAX_LENGTH),
});

export const testSuiteCreateRequestSchema = testSuiteFieldsSchema.meta({ id: 'TestSuiteCreateRequest' });

// The URL id is authoritative; a body id that differs is a 400.
export const testSuiteUpdateRequestSchema = testSuiteFieldsSchema
    .extend({ id: idSchema })
    .meta({ id: 'TestSuiteUpdateRequest' });

export const testSuitePageRequestSchema = pageRequestSchema.extend({
    sort: sortSchema(TEST_SUITE_SORT_FIELDS, TEST_SUITE_DEFAULT_SORT),
});

// Appended to the end of the suite in this order; those already in it keep their position.
export const testSuiteCasesAddRequestSchema = z
    .object({ testCaseIds: selectedTestCaseIdsSchema })
    .meta({ id: 'TestSuiteCasesAddRequest' });

// The suite's new order: every test case in the suite exactly once.
export const testSuiteCasesReorderRequestSchema = z
    .object({ testCaseIds: idListSchema({ min: 1, max: TEST_SUITE_REORDER_MAX }) })
    .meta({ id: 'TestSuiteCasesReorderRequest' });

export const testSuiteProjectParamsSchema = z.object({
    projectId: idParamSchema,
});

export const testSuiteIdParamsSchema = testSuiteProjectParamsSchema.extend({
    suiteId: idParamSchema,
});

export const testSuiteCaseParamsSchema = testSuiteIdParamsSchema.extend({
    testCaseId: idParamSchema,
});

export type TestSuiteCreateRequestDto = z.infer<typeof testSuiteCreateRequestSchema>;
export type TestSuiteUpdateRequestDto = z.infer<typeof testSuiteUpdateRequestSchema>;
export type TestSuiteSort = Sort<TestSuiteSortField>;
export type TestSuitePageRequestDto = z.infer<typeof testSuitePageRequestSchema>;
export type TestSuiteCasesAddRequestDto = z.infer<typeof testSuiteCasesAddRequestSchema>;
export type TestSuiteCasesReorderRequestDto = z.infer<typeof testSuiteCasesReorderRequestSchema>;
