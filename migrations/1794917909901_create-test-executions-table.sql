-- Up Migration

-- One run of one test case (PRD Features §4). PENDING = assigned (or created by a suite run) and not run
-- yet; any other status is a recorded result. Results are immutable (decided 2026-11-17): a correction is a
-- new execution, so history is never rewritten. A test case can be executed any number of times.
-- When the result is recorded, the execution keeps its own snapshot of the test case (title here, steps in
-- test_execution_steps), so editing or deleting the test case later never changes history (§9).
CREATE TABLE test_executions (
    id              integer       GENERATED ALWAYS AS IDENTITY,
    project_id      integer       NOT NULL,
    -- NULL once the test case is deleted; a recorded execution keeps its snapshot. Pending executions are
    -- deleted with their test case by the API (ck_test_executions_pending_has_test_case enforces it).
    test_case_id    integer       NULL,
    suite_run_id    integer       NULL,
    -- Snapshot of the test case title: set when the execution is created, refreshed when the result is
    -- recorded.
    test_case_title varchar(255)  NOT NULL,
    assignee_id     uuid          NULL,
    status          text          NOT NULL DEFAULT 'PENDING',
    comment         varchar(5000) NOT NULL DEFAULT '',
    executed_by     uuid          NULL,
    executed_at     timestamptz   NULL,
    created_by      uuid          NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT pk_test_executions PRIMARY KEY (id),
    -- Target of defects' composite foreign key (a defect is in its execution's project).
    CONSTRAINT uq_test_executions_id_project_id UNIQUE (id, project_id),
    CONSTRAINT fk_test_executions_projects
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT,
    -- Composite: the test case must be in the execution's project. SET NULL (test_case_id) keeps project_id.
    CONSTRAINT fk_test_executions_test_cases
        FOREIGN KEY (test_case_id, project_id) REFERENCES test_cases (id, project_id) ON DELETE SET NULL (test_case_id),
    CONSTRAINT fk_test_executions_suite_runs
        FOREIGN KEY (suite_run_id, project_id) REFERENCES suite_runs (id, project_id) ON DELETE RESTRICT,
    CONSTRAINT fk_test_executions_users_assignee
        FOREIGN KEY (assignee_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_test_executions_users_executed_by
        FOREIGN KEY (executed_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_test_executions_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_test_executions_status
        CHECK (status IN ('PENDING', 'PASS', 'FAIL', 'BLOCKED', 'SKIPPED')),
    -- A recorded result always has its time; a pending execution has none.
    CONSTRAINT ck_test_executions_executed_at
        CHECK ((status = 'PENDING') = (executed_at IS NULL)),
    -- A pending execution without its test case would be unrunnable: deleting the test case must delete
    -- its pending executions first (otherwise ON DELETE SET NULL fails here).
    CONSTRAINT ck_test_executions_pending_has_test_case
        CHECK (status <> 'PENDING' OR test_case_id IS NOT NULL)
);

-- Execution queue and progress (project + status), "assigned to me" (assignee + status), history of one
-- test case (newest first), a suite run's executions, trends over time (analytics).
CREATE INDEX idx_test_executions_project_id_status ON test_executions (project_id, status);
CREATE INDEX idx_test_executions_assignee_id_status ON test_executions (assignee_id, status);
CREATE INDEX idx_test_executions_test_case_id_created_at ON test_executions (test_case_id, created_at DESC);
CREATE INDEX idx_test_executions_suite_run_id ON test_executions (suite_run_id);
CREATE INDEX idx_test_executions_project_id_executed_at ON test_executions (project_id, executed_at);
CREATE INDEX idx_test_executions_executed_by ON test_executions (executed_by);
CREATE INDEX idx_test_executions_created_by ON test_executions (created_by);

-- Down Migration

DROP TABLE test_executions;
