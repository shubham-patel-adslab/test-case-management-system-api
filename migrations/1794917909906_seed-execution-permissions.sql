-- Up Migration

-- PRD Features §1/§4: tester, test-lead and admin execute tests, record results, add comments and
-- attachments, and create defects; read-only only views. Assigning test cases to testers is admin and
-- test-lead only. Which projects is membership, checked in the service.
-- TEST_EXECUTION: CREATE = run ad hoc / run a suite, UPDATE = record a result, add attachments.
INSERT INTO resources_std (resource_code, resource_name, description) VALUES
    ('TEST_EXECUTION', 'Test execution', 'Running tests, recording results, attachments and the audit trail'),
    ('TEST_ASSIGNMENT', 'Test assignment', 'Assigning test cases to testers'),
    ('DEFECT', 'Defect', 'Defects raised from failed executions');

-- Ids are looked up by code, never hardcoded.
INSERT INTO role_resource_permissions_map_std (role_id, resource_id, permission_id)
SELECT r.id, res.id, p.id
  FROM (VALUES
           ('ADMIN', 'TEST_EXECUTION', 'CREATE'), ('ADMIN', 'TEST_EXECUTION', 'READ'), ('ADMIN', 'TEST_EXECUTION', 'UPDATE'),
           ('TEST_LEAD', 'TEST_EXECUTION', 'CREATE'), ('TEST_LEAD', 'TEST_EXECUTION', 'READ'), ('TEST_LEAD', 'TEST_EXECUTION', 'UPDATE'),
           ('TESTER', 'TEST_EXECUTION', 'CREATE'), ('TESTER', 'TEST_EXECUTION', 'READ'), ('TESTER', 'TEST_EXECUTION', 'UPDATE'),
           ('READ_ONLY', 'TEST_EXECUTION', 'READ'),
           ('ADMIN', 'TEST_ASSIGNMENT', 'CREATE'),
           ('TEST_LEAD', 'TEST_ASSIGNMENT', 'CREATE'),
           ('ADMIN', 'DEFECT', 'CREATE'), ('ADMIN', 'DEFECT', 'READ'),
           ('TEST_LEAD', 'DEFECT', 'CREATE'), ('TEST_LEAD', 'DEFECT', 'READ'),
           ('TESTER', 'DEFECT', 'CREATE'), ('TESTER', 'DEFECT', 'READ'),
           ('READ_ONLY', 'DEFECT', 'READ')
       ) AS g (role_code, resource_code, permission_code)
  JOIN roles_std r ON r.role_code = g.role_code
  JOIN resources_std res ON res.resource_code = g.resource_code
  JOIN permissions_std p ON p.permission_code = g.permission_code;

-- Down Migration

DELETE FROM role_resource_permissions_map_std
 WHERE resource_id IN (SELECT id FROM resources_std WHERE resource_code IN ('TEST_EXECUTION', 'TEST_ASSIGNMENT', 'DEFECT'));
DELETE FROM resources_std WHERE resource_code IN ('TEST_EXECUTION', 'TEST_ASSIGNMENT', 'DEFECT');
