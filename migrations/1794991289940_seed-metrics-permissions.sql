-- Up Migration

-- PRD Live Demo: "performance metrics showing caching effectiveness" (GET /api/metrics/cache). Operational data
-- about the service, not project data: admins only.
INSERT INTO resources_std (resource_code, resource_name, description) VALUES
    ('METRICS', 'Metrics', 'Service metrics, e.g. cache hits and misses');

-- Ids are looked up by code, never hardcoded.
INSERT INTO role_resource_permissions_map_std (role_id, resource_id, permission_id)
SELECT r.id, res.id, p.id
  FROM roles_std r
  JOIN resources_std res ON res.resource_code = 'METRICS'
  JOIN permissions_std p ON p.permission_code = 'READ'
 WHERE r.role_code = 'ADMIN';

-- Down Migration

DELETE FROM role_resource_permissions_map_std
 WHERE resource_id IN (SELECT id FROM resources_std WHERE resource_code = 'METRICS');
DELETE FROM resources_std WHERE resource_code = 'METRICS';
