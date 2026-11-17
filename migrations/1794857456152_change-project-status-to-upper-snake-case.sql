-- Up Migration

-- Enum-like values are UPPER_SNAKE_CASE and sent on the wire as stored (decided 2026-11-17), so the API
-- needs no mapping layer between database, TypeScript and JSON.
ALTER TABLE projects DROP CONSTRAINT ck_projects_status;

UPDATE projects SET status = upper(replace(status, '-', '_'));

ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'ACTIVE';
ALTER TABLE projects
    ADD CONSTRAINT ck_projects_status CHECK (status IN ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'));

-- Down Migration

ALTER TABLE projects DROP CONSTRAINT ck_projects_status;

UPDATE projects SET status = lower(replace(status, '_', '-'));

ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE projects
    ADD CONSTRAINT ck_projects_status CHECK (status IN ('active', 'on-hold', 'completed', 'archived'));
