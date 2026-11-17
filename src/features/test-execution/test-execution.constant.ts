// Same values as the test_executions / test_execution_steps / audit constraints. UPPER_SNAKE_CASE in the
// database, TypeScript and JSON. PENDING = assigned (or created by a suite run) and not run yet.
export const EXECUTION_RESULTS = ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'] as const;
export const EXECUTION_STATUSES = ['PENDING', ...EXECUTION_RESULTS] as const;

export type ExecutionResult = (typeof EXECUTION_RESULTS)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_STATUS = {
    PENDING: 'PENDING',
    PASS: 'PASS',
    FAIL: 'FAIL',
} as const;

export const EXECUTION_AUDIT_ACTION = {
    CREATED: 'CREATED',
    RESULT_RECORDED: 'RESULT_RECORDED',
    ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
    DEFECT_CREATED: 'DEFECT_CREATED',
} as const;

export type ExecutionAuditAction = (typeof EXECUTION_AUDIT_ACTION)[keyof typeof EXECUTION_AUDIT_ACTION];

export const EXECUTION_COMMENT_MAX_LENGTH = 5000;
export const EXECUTION_STEP_COMMENT_MAX_LENGTH = 2000;
