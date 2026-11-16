-- Up Migration

-- Lengths and status values mirror the zod schemas (src/features/project/project.constant.ts) so the
-- database enforces the same rules even if a write ever bypasses the API.
CREATE TABLE projects (
    id          integer       GENERATED ALWAYS AS IDENTITY,
    name        varchar(100)  NOT NULL,
    description varchar(1000) NOT NULL DEFAULT '',
    version     varchar(20)   NOT NULL DEFAULT '',
    status      text          NOT NULL DEFAULT 'active',
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT pk_projects PRIMARY KEY (id),
    CONSTRAINT ck_projects_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT ck_projects_status CHECK (status IN ('active', 'on-hold', 'completed', 'archived'))
);

-- Matches the list query's ORDER BY (newest first, id as the unique tie-breaker).
CREATE INDEX idx_projects_created_at_id ON projects (created_at DESC, id DESC);

-- Down Migration

DROP TABLE projects;
