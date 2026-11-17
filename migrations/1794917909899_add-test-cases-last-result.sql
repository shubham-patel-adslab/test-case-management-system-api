-- Up Migration

-- The latest recorded result of each test case, denormalized so the test case list can show, filter and
-- sort by it without a per-row subquery (api-requirements §5). Written in the same transaction as the
-- execution that sets it; NULL until the test case has been executed.
ALTER TABLE test_cases
    ADD COLUMN last_result      text        NULL,
    ADD COLUMN last_executed_at timestamptz NULL;

ALTER TABLE test_cases
    ADD CONSTRAINT ck_test_cases_last_result
        CHECK (last_result IN ('PASS', 'FAIL', 'BLOCKED', 'SKIPPED')),
    -- Both or neither: a result always has its time.
    ADD CONSTRAINT ck_test_cases_last_result_has_time
        CHECK ((last_result IS NULL) = (last_executed_at IS NULL));

-- The lastResult filter within a project.
CREATE INDEX idx_test_cases_project_id_last_result ON test_cases (project_id, last_result);

-- Down Migration

DROP INDEX idx_test_cases_project_id_last_result;
ALTER TABLE test_cases DROP COLUMN last_result, DROP COLUMN last_executed_at;
