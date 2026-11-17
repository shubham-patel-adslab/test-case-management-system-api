import { z } from 'zod';

import { idParamSchema, uuidSchema } from '../../shared/request/id.schema.js';
import { pageRequestSchema, type PageRequestDto } from '../../shared/request/page.request.dto.js';

// Run a whole suite. `assigneeId` assigns every created execution (assigning to someone other than the
// caller needs TEST_ASSIGNMENT CREATE); without it they are unassigned. The body may be empty.
export const suiteRunCreateRequestSchema = z
    .object({ assigneeId: uuidSchema.optional() })
    .meta({ id: 'SuiteRunCreateRequest' });

export const suiteRunPageRequestSchema = pageRequestSchema;

export const suiteRunSuiteParamsSchema = z.object({
    projectId: idParamSchema,
    suiteId: idParamSchema,
});

export const suiteRunIdParamsSchema = z.object({
    projectId: idParamSchema,
    runId: idParamSchema,
});

export type SuiteRunCreateRequestDto = z.infer<typeof suiteRunCreateRequestSchema>;
export type SuiteRunPageRequestDto = PageRequestDto;
