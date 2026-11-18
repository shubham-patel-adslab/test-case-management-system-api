import { z } from 'zod';

import { idParamSchema } from '../../shared/request/id.schema.js';
import { DEFECT_DESCRIPTION_MAX_LENGTH, DEFECT_SEVERITIES, DEFECT_TITLE_MAX_LENGTH } from './defect.constant.js';

// Same rules as the database constraints. The UI prefills title and description (steps to reproduce) from the
// failed execution; the server takes what is sent.
export const defectCreateRequestSchema = z
    .object({
        title: z.string().trim().min(1).max(DEFECT_TITLE_MAX_LENGTH),
        description: z.string().trim().max(DEFECT_DESCRIPTION_MAX_LENGTH),
        severity: z.enum(DEFECT_SEVERITIES),
    })
    .meta({ id: 'DefectCreateRequest' });

export const defectExecutionParamsSchema = z.object({
    projectId: idParamSchema,
    executionId: idParamSchema,
});

export type DefectCreateRequestDto = z.infer<typeof defectCreateRequestSchema>;
