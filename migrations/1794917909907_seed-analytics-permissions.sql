-- Up Migration

-- PRD Features §5 and Backend Req §4: every role, read-only included, can view the analytics dashboard
-- (GET /api/analytics). Which projects it covers is membership (ALL_PROJECTS READ = every project), checked in
-- the service.
INSERT INTO resources_std (resource_code, resource_name, description) VALUES
    ('ANALYTICS', 'Analytics', 'The analytics dashboard: execution summary, trends, coverage, defects');

-- Ids are looked up by code, never hardcoded.
INSERT INTO role_resource_permissions_map_std (role_id, resource_id, permission_id)
SELECT r.id, res.id, p.id
  FROM (VALUES ('ADMIN'), ('TEST_LEAD'), ('TESTER'), ('READ_ONLY')) AS g (role_code)
  JOIN roles_std r ON r.role_code = g.role_code
  JOIN resources_std res ON res.resource_code = 'ANALYTICS'
  JOIN permissions_std p ON p.permission_code = 'READ';

-- Down Migration

DELETE FROM role_resource_permissions_map_std
 WHERE resource_id IN (SELECT id FROM resources_std WHERE resource_code = 'ANALYTICS');
DELETE FROM resources_std WHERE resource_code = 'ANALYTICS';
