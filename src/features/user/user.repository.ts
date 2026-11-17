import { pool, type Queryable } from '../../app/database.js';
import { USER_STATUS, type UserSettableStatus, type UserStatus } from './user.constant.js';

// A user with their role, exactly as `pg` returns it. Deliberately has no password_hash: this is the row
// that becomes a response (user.mapper.ts), so the hash can't leak through it.
export type UserRow = {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string;
    status: UserStatus;
    role_code: string;
    role_name: string;
    created_at: Date;
    updated_at: Date;
};

// Only what sign-in needs. Never mapped to a response. password_hash is null until the user accepts their
// invitation.
export type UserCredentialsRow = {
    id: string;
    password_hash: string | null;
    status: UserStatus;
};

// What `authenticate` checks on every request.
export type UserAuthStateRow = {
    id: string;
    status: UserStatus;
};

export type UserFields = {
    firstName: string;
    lastName: string | null;
    email: string;
};

export type UserListFilter = {
    search: string | undefined;
    statuses: UserStatus[] | undefined;
};

export const USER_EMAIL_UNIQUE_CONSTRAINT = 'uq_users_email';

// Fixed SQL fragments (never request input), so interpolating them is safe. INNER JOIN: every user has
// exactly one role (user_roles is written in the same transaction as the user).
const USER_SELECT = `
    SELECT u.id, u.first_name, u.last_name, u.email, u.status,
           r.role_code, r.role_name, u.created_at, u.updated_at
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles_std r ON r.id = ur.role_id`;

// NULL parameter = filter not applied. One static statement instead of SQL assembled from strings.
const USER_LIST_WHERE = `
     WHERE ($1::text[] IS NULL OR u.status = ANY($1))
       AND ($2::text IS NULL
            OR concat_ws(' ', u.first_name, u.last_name) ILIKE $2
            OR u.email ILIKE $2)`;

// `%` and `_` typed by the user are literal characters, not wildcards.
function toContainsPattern(search: string | undefined): string | null {
    return search === undefined ? null : `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}

// `db` defaults to the pool; pass the transaction's client to run inside withTransaction().
export const userRepository = {
    async selectById(id: string, db: Queryable = pool): Promise<UserRow | undefined> {
        const result = await db.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);

        return result.rows[0];
    },

    // Newest first; `id` breaks ties so a page boundary never repeats or skips a row.
    async selectPage(filter: UserListFilter, limit: number, offset: number): Promise<UserRow[]> {
        const result = await pool.query<UserRow>(
            `${USER_SELECT}
             ${USER_LIST_WHERE}
             ORDER BY u.created_at DESC, u.id DESC
             LIMIT $3 OFFSET $4`,
            [filter.statuses ?? null, toContainsPattern(filter.search), limit, offset],
        );

        return result.rows;
    },

    async count(filter: UserListFilter): Promise<number> {
        const result = await pool.query<{ total: number }>(
            `SELECT COUNT(*)::int AS total FROM (${USER_SELECT} ${USER_LIST_WHERE}) AS matching_users`,
            [filter.statuses ?? null, toContainsPattern(filter.search)],
        );

        return result.rows[0]?.total ?? 0;
    },

    // `email` must already be lowercased — the column only ever holds lowercase (ck_users_email_lowercase).
    async selectCredentialsByEmail(email: string): Promise<UserCredentialsRow | undefined> {
        const result = await pool.query<UserCredentialsRow>(
            'SELECT id, password_hash, status FROM users WHERE email = $1',
            [email],
        );

        return result.rows[0];
    },

    async selectAuthStateById(id: string): Promise<UserAuthStateRow | undefined> {
        const result = await pool.query<UserAuthStateRow>(
            'SELECT id, status FROM users WHERE id = $1',
            [id],
        );

        return result.rows[0];
    },

    // Returns the new id, or undefined when the email is taken. ON CONFLICT makes the uniqueness check and
    // the insert one atomic statement: no check-then-insert race.
    async insert(
        user: UserFields & { status: UserStatus; passwordHash: string | null },
        db: Queryable = pool,
    ): Promise<string | undefined> {
        const result = await db.query<{ id: string }>(
            `INSERT INTO users (first_name, last_name, email, status, password_hash)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT ON CONSTRAINT ${USER_EMAIL_UNIQUE_CONSTRAINT} DO NOTHING
             RETURNING id`,
            [user.firstName, user.lastName, user.email, user.status, user.passwordHash],
        );

        return result.rows[0]?.id;
    },

    // false = no user with that id. An email already used by another user throws a unique violation on
    // USER_EMAIL_UNIQUE_CONSTRAINT (UPDATE has no ON CONFLICT).
    async updateById(id: string, user: UserFields, db: Queryable = pool): Promise<boolean> {
        const result = await db.query(
            `UPDATE users
                SET first_name = $2, last_name = $3, email = $4, updated_at = now()
              WHERE id = $1`,
            [id, user.firstName, user.lastName, user.email],
        );

        return result.rowCount === 1;
    },

    // Reactivating a user who never set a password makes them INVITED again, not ACTIVE (decided in the
    // statement itself, so it can't race with an invitation being accepted).
    async updateStatusById(id: string, status: UserSettableStatus, db: Queryable = pool): Promise<boolean> {
        const result = await db.query(
            `UPDATE users
                SET status = CASE WHEN $2::text = '${USER_STATUS.ACTIVE}' AND password_hash IS NULL
                                  THEN '${USER_STATUS.INVITED}' ELSE $2::text END,
                    updated_at = now()
              WHERE id = $1`,
            [id, status],
        );

        return result.rowCount === 1;
    },

    // Invitation accepted: sets the first password. false = the user is no longer INVITED (deactivated in
    // the meantime).
    async activateWithPassword(id: string, passwordHash: string, db: Queryable = pool): Promise<boolean> {
        const result = await db.query(
            `UPDATE users
                SET password_hash = $2, status = '${USER_STATUS.ACTIVE}', updated_at = now()
              WHERE id = $1 AND status = '${USER_STATUS.INVITED}'`,
            [id, passwordHash],
        );

        return result.rowCount === 1;
    },

    // Assigns the user's one role (insert, or replace the existing assignment — uq_user_roles_user_id).
    // false = no active role with that code. created_by/created_at describe the current assignment.
    async upsertRole(userId: string, roleCode: string, createdById: string | null, db: Queryable = pool): Promise<boolean> {
        const result = await db.query(
            `INSERT INTO user_roles (user_id, role_id, created_by)
             SELECT $1, r.id, $3
               FROM roles_std r
              WHERE r.role_code = $2 AND r.is_active
             ON CONFLICT ON CONSTRAINT uq_user_roles_user_id
             DO UPDATE SET role_id = EXCLUDED.role_id, created_by = EXCLUDED.created_by, created_at = now()`,
            [userId, roleCode, createdById],
        );

        return result.rowCount === 1;
    },
};
