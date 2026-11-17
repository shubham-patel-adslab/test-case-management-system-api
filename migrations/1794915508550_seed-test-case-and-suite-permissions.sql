-- Up Migration

-- PRD Features §1/§3/§6: admin and test-lead create, edit and delete test cases and suites; tester and
-- read-only only view them (testers execute — the executions module). Which projects is membership, checked
-- in the service (ALL_PROJECTS for ADMIN, project_members for everyone else).
INSERT INTO resources_std (resource_code, resource_name, description) VALUES
    ('TEST_CASE', 'Test case', 'Test cases and their steps'),
    ('TEST_SUITE', 'Test suite', 'Test suites and the test cases in them');

-- Ids are looked up by code, never hardcoded.
INSERT INTO role_resource_permissions_map_std (role_id, resource_id, permission_id)
SELECT r.id, res.id, p.id
  FROM (VALUES
           ('ADMIN', 'CREATE'), ('ADMIN', 'READ'), ('ADMIN', 'UPDATE'), ('ADMIN', 'DELETE'),
           ('TEST_LEAD', 'CREATE'), ('TEST_LEAD', 'READ'), ('TEST_LEAD', 'UPDATE'), ('TEST_LEAD', 'DELETE'),
           ('TESTER', 'READ'),
           ('READ_ONLY', 'READ')
       ) AS g (role_code, permission_code)
  JOIN roles_std r ON r.role_code = g.role_code
  CROSS JOIN resources_std res
  JOIN permissions_std p ON p.permission_code = g.permission_code
 WHERE res.resource_code IN ('TEST_CASE', 'TEST_SUITE');

-- Down Migration

DELETE FROM role_resource_permissions_map_std
 WHERE resource_id IN (SELECT id FROM resources_std WHERE resource_code IN ('TEST_CASE', 'TEST_SUITE'));
DELETE FROM resources_std WHERE resource_code IN ('TEST_CASE', 'TEST_SUITE');
