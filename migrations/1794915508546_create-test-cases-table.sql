-- Up Migration

-- PRD Features §3. Every test case belongs to exactly one project. Lengths and enum values mirror the zod
-- schemas (src/features/test-case/test-case.constant.ts), so the database enforces the same rules even if a
-- write bypasses the API. No status column (decided 2026-11-17, as in the PRD): DELETE really deletes, and
-- executions will keep their own copy of the test case (api-requirements §9).
CREATE TABLE test_cases (
    id              integer       GENERATED ALWAYS AS IDENTITY,
    project_id      integer       NOT NULL,
    title           varchar(255)  NOT NULL,
    description     varchar(5000) NOT NULL DEFAULT '',
    priority        text          NOT NULL,
    type            text          NOT NULL,
    pre_conditions  varchar(5000) NOT NULL DEFAULT '',
    post_conditions varchar(5000) NOT NULL DEFAULT '',
    -- Free-form labels. A text[] rather than a tags table: tags have no attributes of their own, and the
    -- GIN index below serves the "has any of these tags" filter (tags && $1).
    tags            text[]        NOT NULL DEFAULT '{}',
    created_by      uuid          NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT pk_test_cases PRIMARY KEY (id),
    -- Target of test_suite_cases' composite foreign key, which keeps suite and case in the same project.
    CONSTRAINT uq_test_cases_id_project_id UNIQUE (id, project_id),
    -- RESTRICT: deleting a project that still has test cases is refused (the API answers 409), so a
    -- project delete can't silently wipe its test cases.
    CONSTRAINT fk_test_cases_projects
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT,
    CONSTRAINT fk_test_cases_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_test_cases_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT ck_test_cases_priority CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CONSTRAINT ck_test_cases_type CHECK (type IN ('FUNCTIONAL', 'INTEGRATION', 'REGRESSION', 'SMOKE', 'UI', 'API')),
    CONSTRAINT ck_test_cases_tags_max CHECK (cardinality(tags) <= 20),
    CONSTRAINT ck_test_cases_tags_no_null CHECK (array_position(tags, NULL) IS NULL)
);

-- The list is always within one project. The first index matches its default order (newest first, id as the
-- unique tie-breaker) and serves every lookup by project_id; the next two serve the priority and type
-- filters (PRD: search and filter by multiple criteria).
CREATE INDEX idx_test_cases_project_id_created_at_id ON test_cases (project_id, created_at DESC, id DESC);
CREATE INDEX idx_test_cases_project_id_priority ON test_cases (project_id, priority);
CREATE INDEX idx_test_cases_project_id_type ON test_cases (project_id, type);
CREATE INDEX idx_test_cases_tags ON test_cases USING gin (tags);
CREATE INDEX idx_test_cases_created_by ON test_cases (created_by);

-- Down Migration

DROP TABLE test_cases;
