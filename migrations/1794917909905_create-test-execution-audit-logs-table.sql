-- Up Migration

-- Audit trail of an execution (PRD Features §4 "Test execution history and audit trail"): who did what and
-- when. Written in the same transaction as the change it describes, so the trail can't miss or invent one.
-- Append-only: no API updates or deletes rows.
CREATE TABLE test_execution_audit_logs (
    id                integer     GENERATED ALWAYS AS IDENTITY,
    test_execution_id integer     NOT NULL,
    action            text        NOT NULL,
    actor_id          uuid        NULL,
    -- What changed, e.g. { "assigneeId": … } or { "status": "FAIL" } — small, action-specific.
    details           jsonb       NOT NULL DEFAULT '{}',
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pk_test_execution_audit_logs PRIMARY KEY (id),
    -- CASCADE: only a pending execution is ever deleted (with its test case), and it has nothing worth
    -- keeping. A recorded execution is never deleted.
    CONSTRAINT fk_test_execution_audit_logs_test_executions
        FOREIGN KEY (test_execution_id) REFERENCES test_executions (id) ON DELETE CASCADE,
    CONSTRAINT fk_test_execution_audit_logs_users_actor
        FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_test_execution_audit_logs_action
        CHECK (action IN ('CREATED', 'RESULT_RECORDED', 'ATTACHMENT_ADDED', 'DEFECT_CREATED'))
);

-- An execution's trail in time order.
CREATE INDEX idx_test_execution_audit_logs_test_execution_id_created_at
    ON test_execution_audit_logs (test_execution_id, created_at);
CREATE INDEX idx_test_execution_audit_logs_actor_id ON test_execution_audit_logs (actor_id);

-- Down Migration

DROP TABLE test_execution_audit_logs;
