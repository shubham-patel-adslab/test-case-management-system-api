-- Up Migration

-- PRD Features §2: only admin and test-lead create/modify projects; every role views them. DELETE (no route
-- yet) is admin only (api-requirements §10 #5). Which projects a non-admin may touch is project membership,
-- checked in the service — these grants only say what each role may do at all.
INSERT INTO resources_std (resource_code, resource_name, description) VALUES
    ('PROJECT', 'Project', 'Test projects and their settings');

-- Ids are looked up by code, never hardcoded.
INSERT INTO role_resource_permissions_map_std (role_id, resource_id, permission_id)
SELECT r.id, res.id, p.id
  FROM (VALUES
           ('ADMIN', 'CREATE'), ('ADMIN', 'READ'), ('ADMIN', 'UPDATE'), ('ADMIN', 'DELETE'),
           ('TEST_LEAD', 'CREATE'), ('TEST_LEAD', 'READ'), ('TEST_LEAD', 'UPDATE'),
           ('TESTER', 'READ'),
           ('READ_ONLY', 'READ')
       ) AS g (role_code, permission_code)
  JOIN roles_std r ON r.role_code = g.role_code
  JOIN resources_std res ON res.resource_code = 'PROJECT'
  JOIN permissions_std p ON p.permission_code = g.permission_code;

-- Down Migration

DELETE FROM role_resource_permissions_map_std
 WHERE resource_id = (SELECT id FROM resources_std WHERE resource_code = 'PROJECT');
DELETE FROM resources_std WHERE resource_code = 'PROJECT';
