// Same values as the users table's constraints. Enum-like values are UPPER_SNAKE_CASE everywhere: database,
// TypeScript and JSON (no mapping layer).
export const USER_STATUS = {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const USER_NAME_MAX_LENGTH = 100;
// The longest address SMTP allows (RFC 5321).
export const USER_EMAIL_MAX_LENGTH = 254;
// Same shape and limit as roles_std.role_code; whether the role exists is checked against the table.
export const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
export const ROLE_CODE_MAX_LENGTH = 50;
// Assigned by the admin-provisioning script (src/scripts/create-admin.ts).
export const ADMIN_ROLE_CODE = 'ADMIN';

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt silently ignores everything after the first 72 bytes, so a longer password would only look
// stronger than it is.
export const PASSWORD_MAX_BYTES = 72;

// ~270 ms per hash with bcryptjs on a dev laptop: slow enough to make offline guessing expensive, fast
// enough for a sign-in request. Raise it as hardware gets faster; existing hashes keep their own cost.
export const BCRYPT_COST = 12;
