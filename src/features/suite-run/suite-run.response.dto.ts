import { z } from 'zod';

import { createPageResponseSchema, type PageResponseDto } from '../../shared/response/page.response.dto.js';
import { testExecutionProgressResponseSchema, testExecutionSummaryResponseSchema } from '../test-execution/test-execution.response.dto.js';
import { userReferenceResponseSchema } from '../user/user.response.dto.js';

// One run of a suite with its progress (PRD "Suite-level reporting").
export const suiteRunSummaryResponseSchema = z
    .object({
        id: z.number().int(),
        projectId: z.number().int(),
        // null once the suite is deleted; the run keeps the suite's name as it was.
        suiteId: z.number().int().nullable(),
        suiteName: z.string(),
        createdBy: userReferenceResponseSchema.nullable(),
        createdAt: z.iso.datetime(),
        progress: testExecutionProgressResponseSchema,
    })
    .meta({ id: 'SuiteRunSummaryResponse' });

// The suite report: the summary plus every execution of the run, in suite order.
export const suiteRunDetailsResponseSchema = suiteRunSummaryResponseSchema
    .extend({ executions: z.array(testExecutionSummaryResponseSchema) })
    .meta({ id: 'SuiteRunDetailsResponse' });

export const suiteRunPageResponseSchema = createPageResponseSchema(suiteRunSummaryResponseSchema)
    .meta({ id: 'SuiteRunPageResponse' });

export type SuiteRunSummaryResponseDto = z.infer<typeof suiteRunSummaryResponseSchema>;
export type SuiteRunDetailsResponseDto = z.infer<typeof suiteRunDetailsResponseSchema>;
export type SuiteRunPageResponseDto = PageResponseDto<SuiteRunSummaryResponseDto>;
