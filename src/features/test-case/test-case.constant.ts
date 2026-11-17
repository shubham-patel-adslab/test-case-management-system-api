// Same values and limits as the test_cases / test_steps constraints. Enum-like values are UPPER_SNAKE_CASE in
// the database, TypeScript and JSON (no mapping layer). Listed lowest to highest priority.
export const TEST_CASE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const TEST_CASE_TYPES = ['FUNCTIONAL', 'INTEGRATION', 'REGRESSION', 'SMOKE', 'UI', 'API'] as const;

export type TestCasePriority = (typeof TEST_CASE_PRIORITIES)[number];
export type TestCaseType = (typeof TEST_CASE_TYPES)[number];

export const TEST_CASE_TITLE_MAX_LENGTH = 255;
// description, pre-conditions and post-conditions.
export const TEST_CASE_TEXT_MAX_LENGTH = 5000;
export const TEST_STEP_TEXT_MAX_LENGTH = 2000;
export const TEST_CASE_STEPS_MAX = 100;
export const TEST_CASE_TAGS_MAX = 20;
export const TEST_CASE_TAG_MAX_LENGTH = 50;
export const TEST_CASE_SUITES_MAX = 100;
export const TEST_CASE_SEARCH_MAX_LENGTH = 100;

// List sorting: `sort=<field>:<direction>`. Each field maps to a fixed SQL expression in the repository. By
// title A→Z unless the client asks otherwise (decided 2026-11-17 — a title counts as a name, and every list of
// named things defaults to name order).
export const TEST_CASE_SORT_FIELDS = ['title', 'priority', 'type', 'createdAt', 'updatedAt', 'lastExecutedAt'] as const;
export const TEST_CASE_DEFAULT_SORT = 'title:asc';

export type TestCaseSortField = (typeof TEST_CASE_SORT_FIELDS)[number];

// PRD Features §3 "Bulk operations (delete, update priority, assign to suite)".
export const TEST_CASE_BULK_ACTION = {
    DELETE: 'DELETE',
    UPDATE_PRIORITY: 'UPDATE_PRIORITY',
    ASSIGN_TO_SUITE: 'ASSIGN_TO_SUITE',
} as const;

// One list page at most (MAX_PAGE_SIZE): bulk actions apply to what the user selected on screen.
export const TEST_CASE_BULK_MAX = 100;

