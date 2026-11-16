import { z } from 'zod';

import { idParamSchema, idSchema } from '../../shared/request/id.schema.js';
import { pageRequestSchema, type PageRequestDto } from '../../shared/request/page.request.dto.js';
import {
    PROJECT_DESCRIPTION_MAX_LENGTH,
    PROJECT_NAME_MAX_LENGTH,
    PROJECT_STATUSES,
    PROJECT_VERSION_MAX_LENGTH,
} from './project.constant.js';

// Same rules as the UI's project form schema. trim() runs first, so a whitespace-only name fails
// min(1) and stored values are already trimmed. Unknown fields (id on create, createdAt, …) are stripped.
const projectFieldsSchema = z.object({
    name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
    description: z.string().trim().max(PROJECT_DESCRIPTION_MAX_LENGTH),
    version: z.string().trim().max(PROJECT_VERSION_MAX_LENGTH),
    status: z.enum(PROJECT_STATUSES),
});

export const projectCreateRequestSchema = projectFieldsSchema.meta({ id: 'ProjectCreateRequest' });

// The UI also sends the id in the body; the URL id is authoritative and the two must match.
export const projectUpdateRequestSchema = projectFieldsSchema
    .extend({ id: idSchema })
    .meta({ id: 'ProjectUpdateRequest' });

export const projectPageRequestSchema = pageRequestSchema;

export const projectIdParamsSchema = z.object({
    projectId: idParamSchema,
});

export type ProjectCreateRequestDto = z.infer<typeof projectCreateRequestSchema>;
export type ProjectUpdateRequestDto = z.infer<typeof projectUpdateRequestSchema>;
export type ProjectPageRequestDto = PageRequestDto;
