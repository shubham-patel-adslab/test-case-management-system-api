-- Up Migration

-- One execution of a whole test suite (PRD Features §6 "Execute entire test suites", "Suite-level
-- reporting"): it groups the pending executions created for the suite's test cases.
CREATE TABLE suite_runs (
    id            integer      GENERATED ALWAYS AS IDENTITY,
    project_id    integer      NOT NULL,
    -- NULL once the suite is deleted; the run and its results stay (history).
    test_suite_id integer      NULL,
    -- Snapshot, so a run still has a name after the suite is renamed or deleted.
    suite_name    varchar(150) NOT NULL,
    created_by    uuid         NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_suite_runs PRIMARY KEY (id),
    -- Target of test_executions' composite foreign key (an execution and its run are in the same project).
    CONSTRAINT uq_suite_runs_id_project_id UNIQUE (id, project_id),
    CONSTRAINT fk_suite_runs_projects
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT,
    -- Composite: the suite must be in the run's project. SET NULL (test_suite_id) clears only the suite
    -- column (PostgreSQL 15+), not project_id.
    CONSTRAINT fk_suite_runs_test_suites
        FOREIGN KEY (test_suite_id, project_id) REFERENCES test_suites (id, project_id) ON DELETE SET NULL (test_suite_id),
    CONSTRAINT fk_suite_runs_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

-- A suite's runs, newest first. uq_suite_runs_id_project_id doesn't serve lookups by project.
CREATE INDEX idx_suite_runs_test_suite_id_created_at ON suite_runs (test_suite_id, created_at DESC);
CREATE INDEX idx_suite_runs_project_id ON suite_runs (project_id);
CREATE INDEX idx_suite_runs_created_by ON suite_runs (created_by);

-- Down Migration

DROP TABLE suite_runs;
