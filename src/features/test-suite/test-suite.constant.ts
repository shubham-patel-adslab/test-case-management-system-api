// Same limits as the test_suites constraints.
export const TEST_SUITE_NAME_MAX_LENGTH = 150;
export const TEST_SUITE_DESCRIPTION_MAX_LENGTH = 1000;

// A reorder sends the suite's whole order, so this is also the largest suite that can be reordered.
export const TEST_SUITE_REORDER_MAX = 1000;

// List sorting (`sort=<field>:<direction>`): by name A→Z unless the client asks otherwise (decided 2026-11-17 —
// every list of named things defaults to name order). Each field maps to a fixed SQL expression in the repository.
export const TEST_SUITE_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
export const TEST_SUITE_DEFAULT_SORT = 'name:asc';

export type TestSuiteSortField = (typeof TEST_SUITE_SORT_FIELDS)[number];
