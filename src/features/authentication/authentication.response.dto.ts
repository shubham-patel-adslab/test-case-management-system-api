import { z } from 'zod';

// Who the caller is — the authentication module's answer. What they may do (role, permissions) is the
// authorization module's: GET /authorization/me.
export const authUserResponseSchema = z
    .object({
        id: z.uuid(),
        firstName: z.string(),
        lastName: z.string().nullable(),
        email: z.string(),
    })
    .meta({ id: 'AuthUserResponse' });

export type AuthUserResponseDto = z.infer<typeof authUserResponseSchema>;
