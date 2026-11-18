import { z } from 'zod';

import { userReferenceResponseSchema } from '../user/user.response.dto.js';
import { DEFECT_SEVERITIES } from './defect.constant.js';

// A defect as linked from an execution in the queue / history.
export const defectReferenceResponseSchema = z
    .object({
        id: z.number().int(),
        title: z.string(),
        severity: z.enum(DEFECT_SEVERITIES),
    })
    .meta({ id: 'DefectReferenceResponse' });

export const defectDetailsResponseSchema = defectReferenceResponseSchema
    .extend({
        projectId: z.number().int(),
        executionId: z.number().int(),
        description: z.string(),
        // null once the user row is removed.
        createdBy: userReferenceResponseSchema.nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .meta({ id: 'DefectDetailsResponse' });

export type DefectReferenceResponseDto = z.infer<typeof defectReferenceResponseSchema>;
export type DefectDetailsResponseDto = z.infer<typeof defectDetailsResponseSchema>;
