import { z } from 'zod';

import { createPageResponseSchema, type PageResponseDto } from '../../shared/response/page.response.dto.js';
import { attachmentResponseSchema } from '../attachment/attachment.response.dto.js';
import { defectDetailsResponseSchema, defectReferenceResponseSchema } from '../defect/defect.response.dto.js';
import { userReferenceResponseSchema } from '../user/user.response.dto.js';
import { EXECUTION_AUDIT_ACTION, EXECUTION_RESULTS, EXECUTION_STATUSES } from './test-execution.constant.js';

// One row of the execution queue / a test case's history.
export const testExecutionSummaryResponseSchema = z
    .object({
        id: z.number().int(),
        projectId: z.number().int(),
        // null once the test case is deleted (the execution keeps its title and steps).
        testCaseId: z.number().int().nullable(),
        testCaseTitle: z.string(),
        suiteRunId: z.number().int().nullable(),
        status: z.enum(EXECUTION_STATUSES),
        assignee: userReferenceResponseSchema.nullable(),
        executedBy: userReferenceResponseSchema.nullable(),
        executedAt: z.iso.datetime().nullable(),
        // The defect raised from this execution (only a FAIL can have one).
        defect: defectReferenceResponseSchema.nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .meta({ id: 'TestExecutionSummaryResponse' });

// A step of the execution. Recorded: the snapshot taken when it was run, with its optional result.
// PENDING: the test case's current steps (status null), i.e. what the tester will run.
export const testExecutionStepResponseSchema = z
    .object({
        order: z.number().int(),
        action: z.string(),
        expectedResult: z.string(),
        status: z.enum(EXECUTION_RESULTS).nullable(),
        comment: z.string(),
    })
    .meta({ id: 'TestExecutionStepResponse' });

export const testExecutionDetailsResponseSchema = testExecutionSummaryResponseSchema
    .extend({
        comment: z.string(),
        steps: z.array(testExecutionStepResponseSchema),
        defect: defectDetailsResponseSchema.nullable(),
        attachments: z.array(attachmentResponseSchema),
    })
    .meta({ id: 'TestExecutionDetailsResponse' });

export const testExecutionPageResponseSchema = createPageResponseSchema(testExecutionSummaryResponseSchema)
    .meta({ id: 'TestExecutionPageResponse' });

// PRD "Track execution progress": counts per status.
export const testExecutionProgressResponseSchema = z
    .object({
        total: z.number().int(),
        pending: z.number().int(),
        passed: z.number().int(),
        failed: z.number().int(),
        blocked: z.number().int(),
        skipped: z.number().int(),
    })
    .meta({ id: 'TestExecutionProgressResponse' });

export const testExecutionAssignResponseSchema = z
    .object({
        // Test cases that already had a pending execution for this assignee are skipped.
        createdCount: z.number().int(),
    })
    .meta({ id: 'TestExecutionAssignResponse' });

export const testExecutionAuditLogResponseSchema = z
    .object({
        id: z.number().int(),
        action: z.enum(EXECUTION_AUDIT_ACTION),
        // null once the user row is removed.
        actor: userReferenceResponseSchema.nullable(),
        details: z.record(z.string(), z.unknown()),
        createdAt: z.iso.datetime(),
    })
    .meta({ id: 'TestExecutionAuditLogResponse' });

// Plain array: an execution's trail is short (a handful of entries).
export const testExecutionAuditLogListResponseSchema = z.array(testExecutionAuditLogResponseSchema);

export type TestExecutionSummaryResponseDto = z.infer<typeof testExecutionSummaryResponseSchema>;
export type TestExecutionStepResponseDto = z.infer<typeof testExecutionStepResponseSchema>;
export type TestExecutionDetailsResponseDto = z.infer<typeof testExecutionDetailsResponseSchema>;
export type TestExecutionPageResponseDto = PageResponseDto<TestExecutionSummaryResponseDto>;
export type TestExecutionProgressResponseDto = z.infer<typeof testExecutionProgressResponseSchema>;
export type TestExecutionAssignResponseDto = z.infer<typeof testExecutionAssignResponseSchema>;
export type TestExecutionAuditLogResponseDto = z.infer<typeof testExecutionAuditLogResponseSchema>;
