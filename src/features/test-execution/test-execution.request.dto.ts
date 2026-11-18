import { z } from 'zod';

import { commaSeparatedSchema } from '../../shared/request/comma-separated.schema.js';
import { idParamSchema, idSchema, uuidSchema } from '../../shared/request/id.schema.js';
import { pageRequestSchema } from '../../shared/request/page.request.dto.js';
import { sortSchema, type Sort } from '../../shared/request/sort.schema.js';
import { TEST_CASE_STEPS_MAX } from '../test-case/test-case.constant.js';
import { selectedTestCaseIdsSchema } from '../test-case/test-case.request.dto.js';
import {
    EXECUTION_COMMENT_MAX_LENGTH,
    EXECUTION_DEFAULT_SORT,
    EXECUTION_RESULTS,
    EXECUTION_SORT_FIELDS,
    EXECUTION_STATUSES,
    EXECUTION_STEP_COMMENT_MAX_LENGTH,
    type ExecutionSortField,
} from './test-execution.constant.js';

// A result for one step, by its 1-based `order` in the test case being run (the execution snapshots the
// steps, so the test case's step ids are not used). Steps without an entry get no per-step result.
const stepResultSchema = z.object({
    order: z.number().int().positive(),
    status: z.enum(EXECUTION_RESULTS),
    comment: z.string().trim().max(EXECUTION_STEP_COMMENT_MAX_LENGTH).default(''),
});

// The result of a run. `stepResults` is optional (decided 2026-11-17); whether each order exists, and the
// "no PASS when a step failed" rule, are checked against the test case in the service.
const resultFieldsSchema = z.object({
    status: z.enum(EXECUTION_RESULTS),
    comment: z.string().trim().max(EXECUTION_COMMENT_MAX_LENGTH).default(''),
    stepResults: z
        .array(stepResultSchema)
        .max(TEST_CASE_STEPS_MAX)
        .refine((results) => new Set(results.map((result) => result.order)).size === results.length, {
            message: 'Must not contain the same step order twice',
        })
        .default([]),
});

// Record the result of a PENDING execution (once — results are immutable).
export const testExecutionResultRequestSchema = resultFieldsSchema.meta({ id: 'TestExecutionResultRequest' });

// Run a test case ad hoc (not assigned): the execution is created with its result.
export const testExecutionCreateRequestSchema = resultFieldsSchema
    .extend({ testCaseId: idSchema })
    .meta({ id: 'TestExecutionCreateRequest' });

// Assign test cases to a tester: one PENDING execution each, in the order given.
export const testExecutionAssignRequestSchema = z
    .object({
        testCaseIds: selectedTestCaseIdsSchema,
        assigneeId: uuidSchema,
    })
    .meta({ id: 'TestExecutionAssignRequest' });

// The execution queue and a test case's history (testCaseId). Filters combine with AND.
export const testExecutionPageRequestSchema = pageRequestSchema.extend({
    status: commaSeparatedSchema(z.enum(EXECUTION_STATUSES), `Comma-separated, any of: ${EXECUTION_STATUSES.join(', ')}`),
    assigneeId: uuidSchema.optional(),
    testCaseId: idParamSchema.optional(),
    suiteRunId: idParamSchema.optional(),
    sort: sortSchema(EXECUTION_SORT_FIELDS, EXECUTION_DEFAULT_SORT),
});

export const testExecutionProgressRequestSchema = z.object({
    assigneeId: uuidSchema.optional(),
});

export const testExecutionProjectParamsSchema = z.object({
    projectId: idParamSchema,
});

export const testExecutionIdParamsSchema = testExecutionProjectParamsSchema.extend({
    executionId: idParamSchema,
});

export type TestExecutionResultRequestDto = z.infer<typeof testExecutionResultRequestSchema>;
export type TestExecutionCreateRequestDto = z.infer<typeof testExecutionCreateRequestSchema>;
export type TestExecutionAssignRequestDto = z.infer<typeof testExecutionAssignRequestSchema>;
export type TestExecutionSort = Sort<ExecutionSortField>;
export type TestExecutionPageRequestDto = z.infer<typeof testExecutionPageRequestSchema>;
export type TestExecutionProgressRequestDto = z.infer<typeof testExecutionProgressRequestSchema>;
