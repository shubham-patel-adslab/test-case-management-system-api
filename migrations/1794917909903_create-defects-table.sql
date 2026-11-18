-- Up Migration

-- A defect raised from a failed execution (PRD Features §4 "Create defects/bugs directly from failed
-- tests"). One per execution. "Only from a FAIL" is checked by the API: a CHECK can't look at another table.
CREATE TABLE defects (
    id                integer       GENERATED ALWAYS AS IDENTITY,
    project_id        integer       NOT NULL,
    test_execution_id integer       NOT NULL,
    title             varchar(255)  NOT NULL,
    description       varchar(5000) NOT NULL DEFAULT '',
    severity          text          NOT NULL,
    created_by        uuid          NULL,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT pk_defects PRIMARY KEY (id),
    CONSTRAINT uq_defects_test_execution_id UNIQUE (test_execution_id),
    -- Composite: the defect is in its execution's project (project_id is kept for per-project defect
    -- lists and defect density). RESTRICT: an execution with a defect is never deleted.
    CONSTRAINT fk_defects_test_executions
        FOREIGN KEY (test_execution_id, project_id) REFERENCES test_executions (id, project_id) ON DELETE RESTRICT,
    CONSTRAINT fk_defects_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_defects_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT ck_defects_severity CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);

-- Defects of a project over time (lists, defect density).
CREATE INDEX idx_defects_project_id_created_at ON defects (project_id, created_at);
CREATE INDEX idx_defects_created_by ON defects (created_by);

-- Down Migration

DROP TABLE defects;
