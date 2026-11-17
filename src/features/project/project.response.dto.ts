import { z } from 'zod';

import { createPageResponseSchema, type PageResponseDto } from '../../shared/response/page.response.dto.js';
import { USER_STATUS } from '../user/user.constant.js';
import { userRoleResponseSchema } from '../user/user.response.dto.js';
import { PROJECT_STATUSES } from './project.constant.js';

// A team member, or a candidate in the member picker. `status` lets the UI mark members who were
// deactivated after joining (they stay members) and invited users who haven't signed in yet.
export const projectMemberResponseSchema = z
    .object({
        id: z.uuid(),
        firstName: z.string(),
        lastName: z.string().nullable(),
        email: z.string(),
        status: z.enum(USER_STATUS),
        role: userRoleResponseSchema,
    })
    .meta({ id: 'ProjectMemberResponse' });

export const projectDetailsResponseSchema = z
    .object({
        id: z.number().int(),
        name: z.string(),
        description: z.string(),
        version: z.string(),
        status: z.enum(PROJECT_STATUSES),
        members: z.array(projectMemberResponseSchema),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .meta({ id: 'ProjectDetailsResponse' });

export const projectPageResponseSchema = createPageResponseSchema(projectDetailsResponseSchema)
    .meta({ id: 'ProjectPageResponse' });

export const projectMemberCandidatePageResponseSchema = createPageResponseSchema(projectMemberResponseSchema)
    .meta({ id: 'ProjectMemberCandidatePageResponse' });

export type ProjectMemberResponseDto = z.infer<typeof projectMemberResponseSchema>;
export type ProjectDetailsResponseDto = z.infer<typeof projectDetailsResponseSchema>;
export type ProjectPageResponseDto = PageResponseDto<ProjectDetailsResponseDto>;
export type ProjectMemberCandidatePageResponseDto = PageResponseDto<ProjectMemberResponseDto>;
