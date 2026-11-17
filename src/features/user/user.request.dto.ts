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
    USER_SEARCH_MAX_LENGTH,
    USER_SETTABLE_STATUSES,
    USER_STATUS,
} from './user.constant.js';

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

// A password a user chooses (invitation accept, bootstrap admin). Sign-in accepts any length, so the rule
// can tighten later without locking out existing users.
export const newPasswordSchema = passwordSchema(PASSWORD_MIN_LENGTH);

const nameSchema = z.string().trim().min(1).max(USER_NAME_MAX_LENGTH);

// Optional (decided 2026-11-17). Missing, null or blank all mean "no last name" and are stored as NULL — one
// representation for absence, whatever an empty form field sends.
const optionalNameSchema = z
    .string()
    .trim()
    .max(USER_NAME_MAX_LENGTH)
    .nullish()
    .transform((name) => name || null);

// Shape only; whether an active role with this code exists is checked against roles_std when assigning.
const roleCodeSchema = z.string().trim().max(ROLE_CODE_MAX_LENGTH).regex(ROLE_CODE_PATTERN);

const userFieldsSchema = z.object({
    firstName: nameSchema,
    lastName: optionalNameSchema,
    email: emailSchema,
    roleCode: roleCodeSchema,
});

// No password: the user sets their own by accepting the emailed invitation. Unknown fields (password,
// status, id, …) are stripped.
export const userCreateRequestSchema = userFieldsSchema.meta({ id: 'UserCreateRequest' });

// Full replacement of the editable fields (not the password). Status changes go through PATCH …/status.
// The body id must match the URL id (same rule as projects).
export const userUpdateRequestSchema = userFieldsSchema
    .extend({ id: uuidSchema })
    .meta({ id: 'UserUpdateRequest' });

export const userStatusUpdateRequestSchema = z
    .object({ status: z.enum(USER_SETTABLE_STATUSES) })
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
