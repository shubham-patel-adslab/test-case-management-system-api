-- Up Migration

-- Suite ↔ test case (PRD "Test Suite Cases (mapping table)"). Removing a case from a suite, or deleting a
-- suite, deletes only these rows — never the test case.
-- project_id is repeated here on purpose: the two composite foreign keys below require the suite and the
-- test case to be in this same project, so the database itself rejects a cross-project link, even if a write
-- bypasses the API's check.
CREATE TABLE test_suite_cases (
    id             integer     GENERATED ALWAYS AS IDENTITY,
    project_id     integer     NOT NULL,
    test_suite_id  integer     NOT NULL,
    test_case_id   integer     NOT NULL,
    -- Position in the suite, 1-based (decided 2026-11-17). Gaps after a removal are fine; only the order
    -- matters. A reorder renumbers the whole suite 1..n.
    sequence_order integer     NOT NULL,
    -- Who added the case to the suite.
    created_by     uuid        NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pk_test_suite_cases PRIMARY KEY (id),
    -- A test case is in a suite at most once. Also the arbiter for "add, skip if already there".
    CONSTRAINT uq_test_suite_cases_test_suite_id_test_case_id UNIQUE (test_suite_id, test_case_id),
    -- DEFERRABLE (even INITIALLY IMMEDIATE) makes Postgres check this at the end of each statement instead
    -- of row by row, so a reorder can renumber the whole suite in one UPDATE: two rows swapping places
    -- would otherwise collide mid-statement.
    CONSTRAINT uq_test_suite_cases_test_suite_id_sequence_order UNIQUE (test_suite_id, sequence_order)
        DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT fk_test_suite_cases_test_suites
        FOREIGN KEY (test_suite_id, project_id) REFERENCES test_suites (id, project_id) ON DELETE CASCADE,
    CONSTRAINT fk_test_suite_cases_test_cases
        FOREIGN KEY (test_case_id, project_id) REFERENCES test_cases (id, project_id) ON DELETE CASCADE,
    CONSTRAINT fk_test_suite_cases_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_test_suite_cases_sequence_order_positive CHECK (sequence_order > 0)
);

-- The suite side is served by the two unique constraints (test_suite_id leads both). The test case side —
-- "which suites is this case in" (suiteIds on a test case) and the cascade when a test case is deleted —
-- needs its own index.
CREATE INDEX idx_test_suite_cases_test_case_id ON test_suite_cases (test_case_id);
CREATE INDEX idx_test_suite_cases_created_by ON test_suite_cases (created_by);

-- Down Migration

DROP TABLE test_suite_cases;
