-- Up Migration

-- Ordered steps of a test case (PRD: "Test Steps with expected results"). They belong to the test case and go
-- with it. Replaced as a whole when the test case is updated; executions will keep their own copy, so that
-- never rewrites history (api-requirements §9).
CREATE TABLE test_steps (
    id              integer       GENERATED ALWAYS AS IDENTITY,
    test_case_id    integer       NOT NULL,
    step_order      integer       NOT NULL,
    action          varchar(2000) NOT NULL,
    expected_result varchar(2000) NOT NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT pk_test_steps PRIMARY KEY (id),
    -- Also the index for loading a test case's steps in order (test_case_id is its leading column).
    CONSTRAINT uq_test_steps_test_case_id_step_order UNIQUE (test_case_id, step_order),
    CONSTRAINT fk_test_steps_test_cases
        FOREIGN KEY (test_case_id) REFERENCES test_cases (id) ON DELETE CASCADE,
    CONSTRAINT ck_test_steps_step_order_positive CHECK (step_order > 0),
    CONSTRAINT ck_test_steps_action_not_blank CHECK (btrim(action) <> ''),
    CONSTRAINT ck_test_steps_expected_result_not_blank CHECK (btrim(expected_result) <> '')
);

-- Down Migration

DROP TABLE test_steps;
