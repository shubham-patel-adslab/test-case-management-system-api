-- Up Migration

-- Membership scoping (api-requirements §4): PROJECT grants say what a role may do at all; ALL_PROJECTS
-- grants say it may do so on every project, not only those it is a member of. Only ADMIN holds them
-- (PRD: admin has full access to all projects). Kept as data, so no code compares role names.
INSERT INTO resources_std (resource_code, resource_name, description) VALUES
    ('ALL_PROJECTS', 'All projects', 'Every project, without being a member (otherwise only the user''s own projects)');

-- Ids are looked up by code, never hardcoded.
INSERT INTO role_resource_permissions_map_std (role_id, resource_id, permission_id)
SELECT r.id, res.id, p.id
  FROM (VALUES ('ADMIN', 'READ'), ('ADMIN', 'UPDATE'), ('ADMIN', 'DELETE')) AS g (role_code, permission_code)
  JOIN roles_std r ON r.role_code = g.role_code
  JOIN resources_std res ON res.resource_code = 'ALL_PROJECTS'
  JOIN permissions_std p ON p.permission_code = g.permission_code;

-- Down Migration

DELETE FROM role_resource_permissions_map_std
 WHERE resource_id = (SELECT id FROM resources_std WHERE resource_code = 'ALL_PROJECTS');
DELETE FROM resources_std WHERE resource_code = 'ALL_PROJECTS';
