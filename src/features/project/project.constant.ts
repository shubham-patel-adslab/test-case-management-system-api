// Same values as the projects table's constraint. UPPER_SNAKE_CASE in the database, TypeScript and JSON.
export const PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;

export const PROJECT_NAME_MAX_LENGTH = 100;
export const PROJECT_VERSION_MAX_LENGTH = 20;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 1000;
// Bounds the member list sent with a project (and the SQL arrays built from it).
export const PROJECT_MEMBERS_MAX = 100;

// List sorting (`sort=<field>:<direction>`): by name A→Z unless the client asks otherwise (decided 2026-11-17 —
// every list of named things defaults to name order). Each field maps to a fixed SQL expression in the repository.
export const PROJECT_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
export const PROJECT_DEFAULT_SORT = 'name:asc';

export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];
