-- Up Migration

-- PRD Features §6. Every suite belongs to exactly one project; its test cases are linked through
-- test_suite_cases (a test case can be in several suites of its project).
CREATE TABLE test_suites (
    id          integer       GENERATED ALWAYS AS IDENTITY,
    project_id  integer       NOT NULL,
    name        varchar(150)  NOT NULL,
    description varchar(1000) NOT NULL DEFAULT '',
    created_by  uuid          NULL,
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT pk_test_suites PRIMARY KEY (id),
    -- Target of test_suite_cases' composite foreign key, which keeps suite and case in the same project.
    CONSTRAINT uq_test_suites_id_project_id UNIQUE (id, project_id),
    -- RESTRICT, like test cases: a project with suites can't be deleted by accident.
    CONSTRAINT fk_test_suites_projects
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT,
    CONSTRAINT fk_test_suites_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_test_suites_name_not_blank CHECK (btrim(name) <> '')
);

-- Suite names are unique within a project, ignoring case ("Smoke" and "smoke" would be the same suite to a
-- reader). An expression needs a unique index rather than a UNIQUE constraint; a violation still reports
-- this name. It also serves the suite list (by project, ordered by name) and every lookup by project_id.
CREATE UNIQUE INDEX uq_test_suites_project_id_lower_name ON test_suites (project_id, lower(name));
CREATE INDEX idx_test_suites_created_by ON test_suites (created_by);

-- Down Migration

DROP TABLE test_suites;
