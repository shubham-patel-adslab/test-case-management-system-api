import { pool, type Queryable } from '../../app/database.js';
import { USER_STATUS } from '../user/user.constant.js';

// `db` defaults to the pool; pass the transaction's client to run inside withTransaction().
export const invitationRepository = {
    // The user's one pending invitation: a new one replaces the old (uq_user_invitations_user_id), so a
    // re-sent link makes every earlier link invalid.
    async upsert(
        userId: string,
        tokenHash: string,
        ttlHours: number,
        createdById: string | null,
        db: Queryable = pool,
    ): Promise<void> {
        await db.query(
            `INSERT INTO user_invitations (user_id, token_hash, expires_at, created_by)
             VALUES ($1, $2, now() + make_interval(hours => $3), $4)
             ON CONFLICT ON CONSTRAINT uq_user_invitations_user_id
             DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
                           created_by = EXCLUDED.created_by, created_at = now()`,
            [userId, tokenHash, ttlHours, createdById],
        );
    },

    // Whether the token belongs to an unexpired invitation of a user who is still INVITED. Read-only: the
    // cheap check before the expensive password hash.
    async existsValid(tokenHash: string): Promise<boolean> {
        const result = await pool.query<{ is_valid: boolean }>(
            `SELECT EXISTS (
                 SELECT 1
                   FROM user_invitations i
                   JOIN users u ON u.id = i.user_id
                  WHERE i.token_hash = $1
                    AND i.expires_at > now()
                    AND u.status = '${USER_STATUS.INVITED}'
             ) AS is_valid`,
            [tokenHash],
        );

        return result.rows[0]?.is_valid ?? false;
    },

    // Uses the token up: deletes the unexpired invitation and returns its user id, or undefined. The delete
    // is the claim — of two concurrent requests with the same token, only one gets the row.
    async consume(tokenHash: string, db: Queryable = pool): Promise<string | undefined> {
        const result = await db.query<{ user_id: string }>(
            'DELETE FROM user_invitations WHERE token_hash = $1 AND expires_at > now() RETURNING user_id',
            [tokenHash],
        );

        return result.rows[0]?.user_id;
    },

    async deleteByUserId(userId: string, db: Queryable = pool): Promise<void> {
        await db.query('DELETE FROM user_invitations WHERE user_id = $1', [userId]);
    },
};
