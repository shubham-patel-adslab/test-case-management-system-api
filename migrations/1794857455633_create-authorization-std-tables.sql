-- Up Migration

-- Standard (_std) tables: reference data owned by migrations. There is no API to change them; a change to
-- roles, resources, permissions or their mapping is a new migration, so every environment gets the same
-- rows in the same order. Rows are deactivated (is_active = false), never deleted.
-- Codes are UPPER_SNAKE_CASE and sent on the wire as stored (no mapping layer).

CREATE TABLE roles_std (
    id          integer      GENERATED ALWAYS AS IDENTITY,
    role_code   varchar(50)  NOT NULL,
    role_name   varchar(100) NOT NULL,
    description varchar(500) NOT NULL DEFAULT '',
    -- A role the application itself depends on (e.g. the admin-provisioning script assigns ADMIN).
    is_system   boolean      NOT NULL DEFAULT false,
    is_active   boolean      NOT NULL DEFAULT true,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_roles_std PRIMARY KEY (id),
    CONSTRAINT uq_roles_std_role_code UNIQUE (role_code),
    CONSTRAINT ck_roles_std_role_code_format CHECK (role_code ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE TABLE resources_std (
    id            integer      GENERATED ALWAYS AS IDENTITY,
    resource_code varchar(50)  NOT NULL,
    resource_name varchar(100) NOT NULL,
    description   varchar(500) NOT NULL DEFAULT '',
    is_active     boolean      NOT NULL DEFAULT true,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_resources_std PRIMARY KEY (id),
    CONSTRAINT uq_resources_std_resource_code UNIQUE (resource_code),
    CONSTRAINT ck_resources_std_resource_code_format CHECK (resource_code ~ '^[A-Z][A-Z0-9_]*$')
);

-- Actions, independent of any resource; role_resource_permissions_map_std pairs them with a resource.
CREATE TABLE permissions_std (
    id              integer      GENERATED ALWAYS AS IDENTITY,
    permission_code varchar(50)  NOT NULL,
    permission_name varchar(100) NOT NULL,
    description     varchar(500) NOT NULL DEFAULT '',
    is_active       boolean      NOT NULL DEFAULT true,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_permissions_std PRIMARY KEY (id),
    CONSTRAINT uq_permissions_std_permission_code UNIQUE (permission_code),
    CONSTRAINT ck_permissions_std_permission_code_format CHECK (permission_code ~ '^[A-Z][A-Z0-9_]*$')
);

-- One row = "this role may perform this permission on this resource". No row = denied (deny by default).
CREATE TABLE role_resource_permissions_map_std (
    id            integer     GENERATED ALWAYS AS IDENTITY,
    role_id       integer     NOT NULL,
    resource_id   integer     NOT NULL,
    permission_id integer     NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pk_role_resource_permissions_map_std PRIMARY KEY (id),
    -- Leading role_id also serves the "permissions of this role" lookup, so role_id needs no own index.
    CONSTRAINT uq_role_resource_permissions_map_std_role_resource_permission
        UNIQUE (role_id, resource_id, permission_id),
    CONSTRAINT fk_role_resource_permissions_map_std_roles_std
        FOREIGN KEY (role_id) REFERENCES roles_std (id),
    CONSTRAINT fk_role_resource_permissions_map_std_resources_std
        FOREIGN KEY (resource_id) REFERENCES resources_std (id),
    CONSTRAINT fk_role_resource_permissions_map_std_permissions_std
        FOREIGN KEY (permission_id) REFERENCES permissions_std (id)
);

CREATE INDEX idx_role_resource_permissions_map_std_resource_id
    ON role_resource_permissions_map_std (resource_id);
CREATE INDEX idx_role_resource_permissions_map_std_permission_id
    ON role_resource_permissions_map_std (permission_id);

-- Seed data. The four roles are the PRD's (Features §1).
INSERT INTO roles_std (role_code, role_name, description, is_system) VALUES
    ('ADMIN', 'Admin', 'Full access, including user management and project settings', true),
    ('TEST_LEAD', 'Test lead', 'Manages test cases and suites, assigns tests, views reports for their projects', true),
    ('TESTER', 'Tester', 'Executes tests, records results and creates defects', true),
    ('READ_ONLY', 'Read-only', 'Views test cases, results and reports; cannot change anything', true);

INSERT INTO resources_std (resource_code, resource_name, description) VALUES
    ('USER', 'User', 'User accounts and their role assignment');

INSERT INTO permissions_std (permission_code, permission_name, description) VALUES
    ('CREATE', 'Create', 'Create a record'),
    ('READ', 'Read', 'View records'),
    ('UPDATE', 'Update', 'Change a record'),
    ('DELETE', 'Delete', 'Delete a record');

-- Least privilege: only ADMIN manages users (PRD Backend Req §4: "GET /api/users — admin only"). The other
-- roles get no USER permission; reading one's own account goes through /auth/me, which needs none.
-- Ids are looked up by code, never hardcoded.
INSERT INTO role_resource_permissions_map_std (role_id, resource_id, permission_id)
SELECT r.id, res.id, p.id
  FROM roles_std r
 CROSS JOIN resources_std res
 CROSS JOIN permissions_std p
 WHERE r.role_code = 'ADMIN'
   AND res.resource_code = 'USER'
   AND p.permission_code IN ('CREATE', 'READ', 'UPDATE', 'DELETE');

-- Down Migration

DROP TABLE role_resource_permissions_map_std;
DROP TABLE permissions_std;
DROP TABLE resources_std;
DROP TABLE roles_std;
