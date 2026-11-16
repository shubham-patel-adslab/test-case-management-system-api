import { z } from 'zod';

import { createPageResponseSchema, type PageResponseDto } from '../../shared/response/page.response.dto.js';
import { PROJECT_STATUSES } from './project.constant.js';

// The contract's member also has `role` (ui-requirements §6.5); it's added with users/auth, matching the
// UI's current ProjectMemberResponseDto.
export const projectMemberResponseSchema = z
    .object({
        id: z.number().int(),
        name: z.string(),
        email: z.string(),
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

export type ProjectMemberResponseDto = z.infer<typeof projectMemberResponseSchema>;
export type ProjectDetailsResponseDto = z.infer<typeof projectDetailsResponseSchema>;
export type ProjectPageResponseDto = PageResponseDto<ProjectDetailsResponseDto>;
