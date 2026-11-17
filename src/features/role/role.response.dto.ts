import { z } from 'zod';

export const roleResponseSchema = z
    .object({
        code: z.string(),
        name: z.string(),
        description: z.string(),
    })
    .meta({ id: 'RoleResponse' });

// A plain array, not the paginated envelope: a short reference list bounded by migrations, not user data.
export const roleListResponseSchema = z.array(roleResponseSchema).meta({ id: 'RoleListResponse' });

export type RoleResponseDto = z.infer<typeof roleResponseSchema>;
export type RoleListResponseDto = z.infer<typeof roleListResponseSchema>;
