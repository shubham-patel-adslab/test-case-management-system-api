import { z } from 'zod';

import { uuidSchema } from '../../shared/request/id.schema.js';
import { pageRequestSchema } from '../../shared/request/page.request.dto.js';
import {
    PASSWORD_MAX_BYTES,
    PASSWORD_MIN_LENGTH,
    ROLE_CODE_MAX_LENGTH,
    ROLE_CODE_PATTERN,
    USER_EMAIL_MAX_LENGTH,
    USER_NAME_MAX_LENGTH,
    USER_STATUS,
} from './user.constant.js';

// Search input on the user list; long enough for a full name or an email.
const USER_SEARCH_MAX_LENGTH = 100;

// Trimmed and lowercased before the format check, so " Ana@Example.com" is stored and logs in as
// "ana@example.com". (z.email().trim() would validate first and reject the surrounding spaces.) The docs
// only see the pipe's input side, so `format` is restated for OpenAPI.
export const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .max(USER_EMAIL_MAX_LENGTH)
    .pipe(z.email())
    .meta({ format: 'email' });

// Passwords are never trimmed: spaces are legitimate password characters.
export function passwordSchema(minLength: number) {
    return z
        .string()
        .min(minLength)
        .refine((password) => Buffer.byteLength(password) <= PASSWORD_MAX_BYTES, {
            message: `Must be at most ${PASSWORD_MAX_BYTES} bytes`,
        });
}

const nameSchema = z.string().trim().min(1).max(USER_NAME_MAX_LENGTH);

// Shape only; whether an active role with this code exists is checked against roles_std when assigning.
const roleCodeSchema = z.string().trim().max(ROLE_CODE_MAX_LENGTH).regex(ROLE_CODE_PATTERN);

const userFieldsSchema = z.object({
    firstName: nameSchema,
    lastName: nameSchema,
    email: emailSchema,
    roleCode: roleCodeSchema,
});

// The admin chooses the user's password (no self-service password change yet — decided 2026-11-17). It is
// never returned in a response. Unknown fields (status, id, …) are stripped.
export const userCreateRequestSchema = userFieldsSchema
    .extend({ password: passwordSchema(PASSWORD_MIN_LENGTH) })
    .meta({ id: 'UserCreateRequest' });

// Full replacement of the editable fields (not the password). Status changes go through PATCH …/status.
// The body id must match the URL id (same rule as projects).
export const userUpdateRequestSchema = userFieldsSchema
    .extend({ id: uuidSchema })
    .meta({ id: 'UserUpdateRequest' });

export const userStatusUpdateRequestSchema = z
    .object({ status: z.enum(USER_STATUS) })
    .meta({ id: 'UserStatusUpdateRequest' });

export const userPageRequestSchema = pageRequestSchema.extend({
    // Matches first name, last name, "first last" and email, case-insensitively.
    search: z.string().trim().min(1).max(USER_SEARCH_MAX_LENGTH).optional(),
    status: z.enum(USER_STATUS).optional(),
});

export const userIdParamsSchema = z.object({
    userId: uuidSchema,
});

export type UserCreateRequestDto = z.infer<typeof userCreateRequestSchema>;
export type UserUpdateRequestDto = z.infer<typeof userUpdateRequestSchema>;
export type UserStatusUpdateRequestDto = z.infer<typeof userStatusUpdateRequestSchema>;
export type UserPageRequestDto = z.infer<typeof userPageRequestSchema>;
