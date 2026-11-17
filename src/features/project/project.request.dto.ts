import { z } from 'zod';

import { idParamSchema, idSchema, uuidSchema } from '../../shared/request/id.schema.js';
import { pageRequestSchema } from '../../shared/request/page.request.dto.js';
import { sortSchema, type Sort } from '../../shared/request/sort.schema.js';
import { USER_SEARCH_MAX_LENGTH } from '../user/user.constant.js';
import {
    PROJECT_DEFAULT_SORT,
    PROJECT_DESCRIPTION_MAX_LENGTH,
    PROJECT_MEMBERS_MAX,
    PROJECT_NAME_MAX_LENGTH,
    PROJECT_SORT_FIELDS,
    PROJECT_STATUSES,
    PROJECT_VERSION_MAX_LENGTH,
    type ProjectSortField,
} from './project.constant.js';

// Same rules as the UI's project form schema. trim() runs first, so a whitespace-only name fails
// min(1) and stored values are already trimmed. Unknown fields (id on create, createdAt, …) are stripped.
// memberIds is the whole team, set with the project (no separate member endpoints — decided 2026-11-17).
// Duplicates are rejected rather than merged, so an error's memberIds[i] points at what the client sent.
const projectFieldsSchema = z.object({
    name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
    description: z.string().trim().max(PROJECT_DESCRIPTION_MAX_LENGTH),
    version: z.string().trim().max(PROJECT_VERSION_MAX_LENGTH),
    status: z.enum(PROJECT_STATUSES),
    memberIds: z
        .array(uuidSchema)
        .max(PROJECT_MEMBERS_MAX)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'Must not contain duplicates' }),
});

export const projectCreateRequestSchema = projectFieldsSchema.meta({ id: 'ProjectCreateRequest' });

// Full replacement, members included. The UI also sends the id in the body; the URL id is authoritative
// and the two must match.
export const projectUpdateRequestSchema = projectFieldsSchema
    .extend({ id: idSchema })
    .meta({ id: 'ProjectUpdateRequest' });

export const projectPageRequestSchema = pageRequestSchema.extend({
    sort: sortSchema(PROJECT_SORT_FIELDS, PROJECT_DEFAULT_SORT),
});

// The member picker: users who can be added to a project, by name (no sort option — it's a picker).
export const projectMemberCandidatePageRequestSchema = pageRequestSchema.extend({
    // Matches first name, last name, "first last" and email, case-insensitively.
    search: z.string().trim().min(1).max(USER_SEARCH_MAX_LENGTH).optional(),
});

export const projectIdParamsSchema = z.object({
    projectId: idParamSchema,
});

export type ProjectCreateRequestDto = z.infer<typeof projectCreateRequestSchema>;
export type ProjectUpdateRequestDto = z.infer<typeof projectUpdateRequestSchema>;
export type ProjectSort = Sort<ProjectSortField>;
export type ProjectPageRequestDto = z.infer<typeof projectPageRequestSchema>;
export type ProjectMemberCandidatePageRequestDto = z.infer<typeof projectMemberCandidatePageRequestSchema>;
