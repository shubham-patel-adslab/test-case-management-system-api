// Same values as the projects table's constraint. UPPER_SNAKE_CASE in the database, TypeScript and JSON.
export const PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;

export const PROJECT_NAME_MAX_LENGTH = 100;
export const PROJECT_VERSION_MAX_LENGTH = 20;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 1000;
// Bounds the member list sent with a project (and the SQL arrays built from it).
export const PROJECT_MEMBERS_MAX = 100;
