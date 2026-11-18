import { pool, type Queryable } from '../../app/database.js';
import type { DefectSeverity } from './defect.constant.js';
import type { DefectCreateRequestDto } from './defect.request.dto.js';

// A defect with its creator's name, as `pg` returns it.
export type DefectRow = {
    id: number;
    project_id: number;
    test_execution_id: number;
    title: string;
    description: string;
    severity: DefectSeverity;
    creator_id: string | null;
    creator_first_name: string | null;
    creator_last_name: string | null;
    created_at: Date;
    updated_at: Date;
};

// `db` defaults to the pool; pass the transaction's client inside withTransaction().
export const defectRepository = {
    // Returns the new id, or undefined when the execution already has a defect: ON CONFLICT makes "one per
    // execution" one atomic statement, so two concurrent requests can't both create one.
    async insert(projectId: number, executionId: number, defect: DefectCreateRequestDto, createdById: string, db: Queryable): Promise<number | undefined> {
        const result = await db.query<{ id: number }>(
            `INSERT INTO defects (project_id, test_execution_id, title, description, severity, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT ON CONSTRAINT uq_defects_test_execution_id DO NOTHING
             RETURNING id`,
            [projectId, executionId, defect.title, defect.description, defect.severity, createdById],
        );

        return result.rows[0]?.id;
    },

    // The execution's defect (at most one — uq_defects_test_execution_id).
    async selectByExecution(executionId: number, db: Queryable = pool): Promise<DefectRow | undefined> {
        const result = await db.query<DefectRow>(
            `SELECT d.id, d.project_id, d.test_execution_id, d.title, d.description, d.severity,
                    u.id AS creator_id, u.first_name AS creator_first_name, u.last_name AS creator_last_name,
                    d.created_at, d.updated_at
               FROM defects d
               LEFT JOIN users u ON u.id = d.created_by
              WHERE d.test_execution_id = $1`,
            [executionId],
        );

        return result.rows[0];
    },
};
