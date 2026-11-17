-- Up Migration

-- Exactly one role per user. uq_user_roles_user_id guarantees "at most one"; "at least one" is guaranteed
-- by the application: user creation inserts the user and its role in one transaction, and no API removes
-- a role (a role change is an upsert of this row). A CHECK can't express "a users row must have a
-- user_roles row" without a deferred trigger, which isn't worth it here.
-- Not _std: these rows are runtime data written through the API.
CREATE TABLE user_roles (
    id         integer     GENERATED ALWAYS AS IDENTITY,
    user_id    uuid        NOT NULL,
    role_id    integer     NOT NULL,
    -- The admin who made the current assignment; NULL for the bootstrap admin (created by script).
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pk_user_roles PRIMARY KEY (id),
    CONSTRAINT uq_user_roles_user_id UNIQUE (user_id),
    -- The assignment belongs to the user: if a user row is ever removed (by SQL — the API only
    -- deactivates), its role row goes with it.
    CONSTRAINT fk_user_roles_users
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_roles_std
        FOREIGN KEY (role_id) REFERENCES roles_std (id),
    CONSTRAINT fk_user_roles_users_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

-- uq_user_roles_user_id already indexes user_id.
CREATE INDEX idx_user_roles_role_id ON user_roles (role_id);
CREATE INDEX idx_user_roles_created_by ON user_roles (created_by);

-- Down Migration

DROP TABLE user_roles;
