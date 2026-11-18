import { pool, toOrderBy, type Queryable } from '../../app/database.js';
import { USER_STATUS } from '../user/user.constant.js';
import type { UserRow } from '../user/user.repository.js';
import type { PROJECT_STATUSES, ProjectSortField } from './project.constant.js';
import type { ProjectCreateRequestDto, ProjectSort } from './project.request.dto.js';

// A row exactly as `pg` returns it from the projects table.
export type ProjectRow = {
    id: number;
    name: string;
    description: string;
    version: string;
    status: (typeof PROJECT_STATUSES)[number];
    created_at: Date;
    updated_at: Date;
};

// The user columns a member is shown with — a subset of the user list's row, so a UserRow (member
// candidates) maps through the same function.
export type ProjectMemberUserRow = Pick<UserRow, 'id' | 'first_name' | 'last_name' | 'email' | 'status' | 'role_code' | 'role_name'>;

export type ProjectMemberRow = ProjectMemberUserRow & {
    project_id: number;
};

// Membership scope: null = every project (the caller holds an ALL_PROJECTS grant), a user id = only the
// projects that user is a member of.
export type ProjectScope = string | null;

type ProjectFields = Pick<ProjectCreateRequestDto, 'name' | 'description' | 'version' | 'status'>;

// ON DELETE RESTRICT foreign keys: a project that still has test cases, suites or execution history (which
// is never deleted) can't be deleted.
export const PROJECT_CONTENT_FOREIGN_KEYS = [
    'fk_test_cases_projects',
    'fk_test_suites_projects',
    'fk_test_executions_projects',
    'fk_suite_runs_projects',
] as const;

// A fixed list of column names (never request input), so interpolating it into SQL is safe.
const PROJECT_COLUMNS = 'id, name, description, version, status, created_at, updated_at';

// Names compare case-insensitively ("alpha" next to "Alpha", not after "Zeta").
const SORT_EXPRESSIONS: Record<ProjectSortField, string> = {
    name: 'lower(p.name)',
    createdAt: 'p.created_at',
    updatedAt: 'p.updated_at',
};

// The scope filter on projects aliased `p`. `parameter` is a fixed placeholder such as '$1', never input.
// Served by uq_project_members_project_id_user_id.
function isInScope(parameter: string): string {
    return `(${parameter}::uuid IS NULL
             OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ${parameter}))`;
}

// INSERT … RETURNING always yields the row.
function firstRowOrThrow<TRow>(rows: TRow[], operation: string): TRow {
    const row = rows[0];

    if (!row) {
        throw new Error(`${operation} returned no row`);
    }

    return row;
}

// `db` defaults to the pool; pass the transaction's client to run inside withTransaction().
export const projectRepository = {
    async selectPage(scope: ProjectScope, sort: ProjectSort, limit: number, offset: number): Promise<ProjectRow[]> {
        const result = await pool.query<ProjectRow>(
            `SELECT ${PROJECT_COLUMNS}
               FROM projects p
              WHERE ${isInScope('$1')}
              ${toOrderBy(SORT_EXPRESSIONS, sort, 'p.id')}
              LIMIT $2 OFFSET $3`,
            [scope, limit, offset],
        );

        return result.rows;
    },

    async count(scope: ProjectScope): Promise<number> {
        const result = await pool.query<{ total: number }>(
            `SELECT COUNT(*)::int AS total FROM projects p WHERE ${isInScope('$1')}`,
            [scope],
        );

        return firstRowOrThrow(result.rows, 'COUNT projects').total;
    },

    // undefined = no such project, or not in the caller's scope.
    async selectById(id: number, scope: ProjectScope): Promise<ProjectRow | undefined> {
        const result = await pool.query<ProjectRow>(
            `SELECT ${PROJECT_COLUMNS} FROM projects p WHERE id = $1 AND ${isInScope('$2')}`,
            [id, scope],
        );

        return result.rows[0];
    },

    // The ids of every project in the scope — what a cross-project cached value (analytics) depends on.
    async selectIdsInScope(scope: ProjectScope): Promise<number[]> {
        const result = await pool.query<{ id: number }>(`SELECT p.id FROM projects p WHERE ${isInScope('$1')}`, [scope]);

        return result.rows.map((row) => row.id);
    },

    // The projects a user is on the team of (idx_project_members_user_id) — the cached project data that shows them.
    async selectIdsByMember(userId: string): Promise<number[]> {
        const result = await pool.query<{ project_id: number }>('SELECT project_id FROM project_members WHERE user_id = $1', [userId]);

        return result.rows.map((row) => row.project_id);
    },

    // For work inside a project (test cases, suites): does it exist in the caller's scope? `isLocked` (inside a
    // transaction) takes FOR KEY SHARE on the project row until the transaction ends: the project can't be
    // deleted meanwhile, while edits of the project itself aren't blocked.
    async existsInScope(id: number, scope: ProjectScope, db: Queryable = pool, isLocked = false): Promise<boolean> {
        const result = await db.query(
            `SELECT 1 FROM projects p WHERE id = $1 AND ${isInScope('$2')} ${isLocked ? 'FOR KEY SHARE' : ''}`,
            [id, scope],
        );

        return result.rowCount === 1;
    },

    async insert(project: ProjectFields, createdById: string, db: Queryable = pool): Promise<ProjectRow> {
        const result = await db.query<ProjectRow>(
            `INSERT INTO projects (name, description, version, status, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING ${PROJECT_COLUMNS}`,
            [project.name, project.description, project.version, project.status, createdById],
        );

        return firstRowOrThrow(result.rows, 'INSERT project');
    },

    // undefined = no such project, or not in the caller's scope. The UPDATE also locks the row until the
    // transaction ends, so concurrent edits of one project (and its team) run one after the other.
    async updateById(id: number, project: ProjectFields, scope: ProjectScope, db: Queryable = pool): Promise<ProjectRow | undefined> {
        const result = await db.query<ProjectRow>(
            `UPDATE projects p
                SET name = $2, description = $3, version = $4, status = $5, updated_at = now()
              WHERE id = $1 AND ${isInScope('$6')}
             RETURNING ${PROJECT_COLUMNS}`,
            [id, project.name, project.description, project.version, project.status, scope],
        );

        return result.rows[0];
    },

    // false = no such project, or not in the caller's scope. Memberships go with it (ON DELETE CASCADE); a
    // project that still has test cases or suites throws a foreign key violation (PROJECT_CONTENT_FOREIGN_KEYS).
    async deleteById(id: number, scope: ProjectScope): Promise<boolean> {
        const result = await pool.query(`DELETE FROM projects p WHERE id = $1 AND ${isInScope('$2')}`, [id, scope]);

        return result.rowCount === 1;
    },

    // Members of several projects in one query (a list page needs them for every row — no N+1).
    async selectMembers(projectIds: number[], db: Queryable = pool): Promise<ProjectMemberRow[]> {
        const result = await db.query<ProjectMemberRow>(
            `SELECT pm.project_id, u.id, u.first_name, u.last_name, u.email, u.status, r.role_code, r.role_name
               FROM project_members pm
               JOIN users u ON u.id = pm.user_id
               JOIN user_roles ur ON ur.user_id = u.id
               JOIN roles_std r ON r.id = ur.role_id
              WHERE pm.project_id = ANY($1::int[])
              ORDER BY lower(concat_ws(' ', u.first_name, u.last_name)), u.email`,
            [projectIds],
        );

        return result.rows;
    },

    // Which of `userIds` may be on the project's team: existing users who aren't INACTIVE, plus current
    // members whatever their status (a member deactivated later must not block saving the project).
    async selectAssignableUserIds(projectId: number, userIds: string[], db: Queryable = pool): Promise<string[]> {
        const result = await db.query<{ id: string }>(
            `SELECT u.id
               FROM users u
              WHERE u.id = ANY($2::uuid[])
                AND (u.status <> '${USER_STATUS.INACTIVE}'
                     OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = u.id))`,
            [projectId, userIds],
        );

        return result.rows.map((row) => row.id);
    },

    // Makes the team exactly `userIds`: removes the others, adds the missing ones. Members who stay keep
    // their row (and who added them, and when).
    async replaceMembers(projectId: number, userIds: string[], createdById: string, db: Queryable = pool): Promise<void> {
        await db.query(
            'DELETE FROM project_members WHERE project_id = $1 AND NOT (user_id = ANY($2::uuid[]))',
            [projectId, userIds],
        );
        await db.query(
            `INSERT INTO project_members (project_id, user_id, created_by)
             SELECT $1, user_id, $3 FROM unnest($2::uuid[]) AS new_members (user_id)
             ON CONFLICT ON CONSTRAINT uq_project_members_project_id_user_id DO NOTHING`,
            [projectId, userIds, createdById],
        );
    },
};
