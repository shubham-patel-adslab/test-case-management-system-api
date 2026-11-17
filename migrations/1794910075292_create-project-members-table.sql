-- Up Migration

-- Project team (PRD Features §2 "assign team members"). TEST_LEAD, TESTER and READ_ONLY act only within
-- projects they are members of; a role holding ALL_PROJECTS grants (ADMIN) acts on every project without
-- being a member. Members are set as a whole with the project (POST/PUT /projects, `memberIds`).
-- Not _std: runtime data written through the API.
CREATE TABLE project_members (
    id         integer     GENERATED ALWAYS AS IDENTITY,
    project_id integer     NOT NULL,
    user_id    uuid        NOT NULL,
    -- Who added this member; NULL once that user row is removed.
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pk_project_members PRIMARY KEY (id),
    CONSTRAINT uq_project_members_project_id_user_id UNIQUE (project_id, user_id),
    -- A membership belongs to both sides: it goes with a deleted project, and with a user row removed by
    -- SQL (the API only deactivates users).
    CONSTRAINT fk_project_members_projects
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_members_users
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_members_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

-- uq_project_members_project_id_user_id already serves lookups by project_id (its leading column); the
-- "projects I am a member of" filter looks up by user_id.
CREATE INDEX idx_project_members_user_id ON project_members (user_id);
CREATE INDEX idx_project_members_created_by ON project_members (created_by);

-- Down Migration

DROP TABLE project_members;
