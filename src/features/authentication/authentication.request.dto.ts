import { z } from 'zod';

import { emailSchema, passwordSchema } from '../user/user.request.dto.js';

// No minimum length on sign-in: a wrong password is a 401, not a validation error that hints at the rules.
export const authSignInRequestSchema = z
    .object({
        email: emailSchema,
        password: passwordSchema(1),
    })
    .meta({ id: 'AuthSignInRequest' });

export type AuthSignInRequestDto = z.infer<typeof authSignInRequestSchema>;
