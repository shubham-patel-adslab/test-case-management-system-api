import { z } from 'zod';

import { createPageResponseSchema, type PageResponseDto } from '../../shared/response/page.response.dto.js';
import { USER_STATUS } from './user.constant.js';

// Role codes are data (roles_std), not a fixed enum, so the schema doesn't list them.
export const userRoleResponseSchema = z
    .object({
        code: z.string(),
        name: z.string(),
    })
    .meta({ id: 'UserRoleResponse' });

export const userDetailsResponseSchema = z
    .object({
        id: z.uuid(),
        firstName: z.string(),
        lastName: z.string(),
        email: z.string(),
        status: z.enum(USER_STATUS),
        role: userRoleResponseSchema,
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .meta({ id: 'UserDetailsResponse' });

export const userPageResponseSchema = createPageResponseSchema(userDetailsResponseSchema)
    .meta({ id: 'UserPageResponse' });

export type UserRoleResponseDto = z.infer<typeof userRoleResponseSchema>;
export type UserDetailsResponseDto = z.infer<typeof userDetailsResponseSchema>;
export type UserPageResponseDto = PageResponseDto<UserDetailsResponseDto>;
