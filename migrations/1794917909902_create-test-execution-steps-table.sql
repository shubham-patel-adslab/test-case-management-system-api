-- Up Migration

-- The steps as they were when the result was recorded (snapshot, api-requirements §9), each with an
-- optional per-step result (decided 2026-11-17). Addressed by step_order, not by the test case's step ids,
-- which change whenever the test case's steps are replaced.
CREATE TABLE test_execution_steps (
    id                integer       GENERATED ALWAYS AS IDENTITY,
    test_execution_id integer       NOT NULL,
    step_order        integer       NOT NULL,
    action            varchar(2000) NOT NULL,
    expected_result   varchar(2000) NOT NULL,
    -- NULL = no per-step result recorded.
    status            text          NULL,
    comment           varchar(2000) NOT NULL DEFAULT '',

    CONSTRAINT pk_test_execution_steps PRIMARY KEY (id),
    -- Also the index for loading an execution's steps in order.
    CONSTRAINT uq_test_execution_steps_test_execution_id_step_order UNIQUE (test_execution_id, step_order),
    CONSTRAINT fk_test_execution_steps_test_executions
        FOREIGN KEY (test_execution_id) REFERENCES test_executions (id) ON DELETE CASCADE,
    CONSTRAINT ck_test_execution_steps_step_order_positive CHECK (step_order > 0),
    CONSTRAINT ck_test_execution_steps_status CHECK (status IN ('PASS', 'FAIL', 'BLOCKED', 'SKIPPED'))
);

-- Down Migration

DROP TABLE test_execution_steps;
