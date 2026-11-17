-- Up Migration

-- Who created the project (audit). NULL for projects created before this column existed, and once that
-- user row is removed (the API only deactivates users).
ALTER TABLE projects ADD COLUMN created_by uuid NULL;

ALTER TABLE projects
    ADD CONSTRAINT fk_projects_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX idx_projects_created_by ON projects (created_by);

-- Down Migration

ALTER TABLE projects DROP COLUMN created_by;
