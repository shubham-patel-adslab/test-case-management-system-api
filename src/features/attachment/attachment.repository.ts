import { pool, type Queryable } from '../../app/database.js';

// An attachment with its uploader's name and its execution's project, as `pg` returns it.
export type AttachmentRow = {
    id: number;
    project_id: number;
    test_execution_id: number;
    original_name: string;
    stored_name: string;
    mime_type: string;
    size_bytes: number;
    uploader_id: string | null;
    uploader_first_name: string | null;
    uploader_last_name: string | null;
    created_at: Date;
};

export type AttachmentFields = {
    originalName: string;
    storedName: string;
    mimeType: string;
    sizeBytes: number;
};

// Fixed SQL fragment (never request input). Attachments have no project column: the project is the
// execution's.
const ATTACHMENT_SELECT = `
    SELECT a.id, e.project_id, a.test_execution_id, a.original_name, a.stored_name, a.mime_type, a.size_bytes,
           u.id AS uploader_id, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name, a.created_at
      FROM attachments a
      JOIN test_executions e ON e.id = a.test_execution_id
      LEFT JOIN users u ON u.id = a.uploaded_by`;

// `db` defaults to the pool; pass the transaction's client inside withTransaction().
export const attachmentRepository = {
    // Returns the new ids, in the order given.
    async insertMany(executionId: number, files: AttachmentFields[], uploadedById: string, db: Queryable): Promise<number[]> {
        const result = await db.query<{ id: number }>(
            `INSERT INTO attachments (test_execution_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
             SELECT $1, f.original_name, f.stored_name, f.mime_type, f.size_bytes, $6
               FROM unnest($2::text[], $3::text[], $4::text[], $5::int[]) WITH ORDINALITY
                    AS f (original_name, stored_name, mime_type, size_bytes, position)
              ORDER BY f.position
             RETURNING id`,
            [
                executionId,
                files.map((file) => file.originalName),
                files.map((file) => file.storedName),
                files.map((file) => file.mimeType),
                files.map((file) => file.sizeBytes),
                uploadedById,
            ],
        );

        return result.rows.map((row) => row.id);
    },

    // By file name, like every list of named things.
    async selectByExecution(executionId: number, db: Queryable = pool): Promise<AttachmentRow[]> {
        const result = await db.query<AttachmentRow>(
            `${ATTACHMENT_SELECT} WHERE a.test_execution_id = $1 ORDER BY lower(a.original_name), a.id`,
            [executionId],
        );

        return result.rows;
    },

    // Scoped by the execution's project: an attachment id is only valid with its own project.
    async selectByIdInProject(projectId: number, id: number): Promise<AttachmentRow | undefined> {
        const result = await pool.query<AttachmentRow>(`${ATTACHMENT_SELECT} WHERE e.project_id = $1 AND a.id = $2`, [projectId, id]);

        return result.rows[0];
    },
};
