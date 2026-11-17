import { z } from 'zod';

import { idListSchema, idParamSchema, idSchema } from '../../shared/request/id.schema.js';
import { commaSeparatedSchema } from '../../shared/request/comma-separated.schema.js';
import { pageRequestSchema } from '../../shared/request/page.request.dto.js';
import { sortSchema, type Sort } from '../../shared/request/sort.schema.js';
import { EXECUTION_RESULTS } from '../test-execution/test-execution.constant.js';
import {
    TEST_CASE_BULK_ACTION,
    TEST_CASE_BULK_MAX,
    TEST_CASE_DEFAULT_SORT,
    TEST_CASE_PRIORITIES,
    TEST_CASE_SEARCH_MAX_LENGTH,
    TEST_CASE_SORT_FIELDS,
    TEST_CASE_STEPS_MAX,
    TEST_CASE_SUITES_MAX,
    TEST_CASE_TAG_MAX_LENGTH,
    TEST_CASE_TAGS_MAX,
    TEST_CASE_TEXT_MAX_LENGTH,
    TEST_CASE_TITLE_MAX_LENGTH,
    TEST_CASE_TYPES,
    TEST_STEP_TEXT_MAX_LENGTH,
    type TestCaseSortField,
} from './test-case.constant.js';

// Tags are stored lowercase, so "Login" and "login" are one tag and the tag filter is case-insensitive. No
// commas: the list filter takes tags comma-separated.
const tagSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(TEST_CASE_TAG_MAX_LENGTH)
    .regex(/^[^,]*$/, { message: 'Must not contain a comma' });

// The step's position is its index in the array (1-based in the database): the array order is the order.
const testStepSchema = z.object({
    action: z.string().trim().min(1).max(TEST_STEP_TEXT_MAX_LENGTH),
    expectedResult: z.string().trim().min(1).max(TEST_STEP_TEXT_MAX_LENGTH),
});

// Same rules as the database constraints. trim() runs first, so whitespace-only values fail min(1). Unknown
// fields (id, projectId, createdBy, …) are stripped. Every field is required: create and update send the
// whole test case (PUT is a full replacement — steps and suites included).
const testCaseFieldsSchema = z.object({
    title: z.string().trim().min(1).max(TEST_CASE_TITLE_MAX_LENGTH),
    description: z.string().trim().max(TEST_CASE_TEXT_MAX_LENGTH),
    priority: z.enum(TEST_CASE_PRIORITIES),
    type: z.enum(TEST_CASE_TYPES),
    preConditions: z.string().trim().max(TEST_CASE_TEXT_MAX_LENGTH),
    postConditions: z.string().trim().max(TEST_CASE_TEXT_MAX_LENGTH),
    // Duplicates (after lowercasing) are merged: a tag set has no order or positions to point at.
    tags: z.array(tagSchema).max(TEST_CASE_TAGS_MAX).transform((tags) => [...new Set(tags)]),
    // PRD/UI: at least one step.
    steps: z.array(testStepSchema).min(1).max(TEST_CASE_STEPS_MAX),
    // Every suite (of the same project) the test case is in.
    suiteIds: idListSchema({ max: TEST_CASE_SUITES_MAX }),
});

export const testCaseCreateRequestSchema = testCaseFieldsSchema.meta({ id: 'TestCaseCreateRequest' });

// The URL id is authoritative; a body id that differs is a 400 (same rule as projects and users).
export const testCaseUpdateRequestSchema = testCaseFieldsSchema
    .extend({ id: idSchema })
    .meta({ id: 'TestCaseUpdateRequest' });

// Selected test cases of the project, in the order selected (ASSIGN_TO_SUITE appends them in this order).
// Also the body of "add test cases to a suite".
export const selectedTestCaseIdsSchema = idListSchema({ min: 1, max: TEST_CASE_BULK_MAX });

// One endpoint, the action decides the other fields. All-or-nothing: an id that isn't a test case of the
// project rejects the whole request.
export const testCaseBulkRequestSchema = z
    .discriminatedUnion('action', [
        z.object({ action: z.literal(TEST_CASE_BULK_ACTION.DELETE), testCaseIds: selectedTestCaseIdsSchema }),
        z.object({
            action: z.literal(TEST_CASE_BULK_ACTION.UPDATE_PRIORITY),
            testCaseIds: selectedTestCaseIdsSchema,
            priority: z.enum(TEST_CASE_PRIORITIES),
        }),
        z.object({
            action: z.literal(TEST_CASE_BULK_ACTION.ASSIGN_TO_SUITE),
            testCaseIds: selectedTestCaseIdsSchema,
            suiteId: idSchema,
        }),
    ])
    .meta({ id: 'TestCaseBulkRequest' });

export type TestCaseSort = Sort<TestCaseSortField>;

// Query string. Every filter is optional; filters combine with AND, values within one filter with OR.
export const testCasePageRequestSchema = pageRequestSchema.extend({
    // Matches title or description, case-insensitively.
    search: z.string().trim().min(1).max(TEST_CASE_SEARCH_MAX_LENGTH).optional(),
    priority: commaSeparatedSchema(z.enum(TEST_CASE_PRIORITIES), `Comma-separated, any of: ${TEST_CASE_PRIORITIES.join(', ')}`),
    type: commaSeparatedSchema(z.enum(TEST_CASE_TYPES), `Comma-separated, any of: ${TEST_CASE_TYPES.join(', ')}`),
    tags: commaSeparatedSchema(tagSchema, 'Comma-separated; test cases having any of these tags (case-insensitive)'),
    suiteId: idParamSchema.optional(),
    lastResult: commaSeparatedSchema(z.enum(EXECUTION_RESULTS), `Comma-separated, any of: ${EXECUTION_RESULTS.join(', ')} (never-executed test cases have none)`),
    // `<field>:<asc|desc>`; lastExecutedAt puts never-executed test cases last; priority sorts by rank (CRITICAL highest), not alphabetically.
    sort: sortSchema(TEST_CASE_SORT_FIELDS, TEST_CASE_DEFAULT_SORT),
});

export const testCaseProjectParamsSchema = z.object({
    projectId: idParamSchema,
});

export const testCaseIdParamsSchema = testCaseProjectParamsSchema.extend({
    testCaseId: idParamSchema,
});

export type TestCaseCreateRequestDto = z.infer<typeof testCaseCreateRequestSchema>;
export type TestCaseUpdateRequestDto = z.infer<typeof testCaseUpdateRequestSchema>;
export type TestCasePageRequestDto = z.infer<typeof testCasePageRequestSchema>;
export type TestCaseBulkRequestDto = z.infer<typeof testCaseBulkRequestSchema>;
