import { pool } from '../../app/database.js';
import type { PROJECT_STATUSES } from './project.constant.js';
import type { ProjectCreateRequestDto } from './project.request.dto.js';

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

type ProjectFields = Pick<ProjectCreateRequestDto, 'name' | 'description' | 'version' | 'status'>;

// A fixed list of column names (never request input), so interpolating it into SQL is safe.
const PROJECT_COLUMNS = 'id, name, description, version, status, created_at, updated_at';

// INSERT/UPDATE … RETURNING always yields the row unless the WHERE matched nothing.
function firstRowOrThrow<TRow>(rows: TRow[], operation: string): TRow {
    const row = rows[0];

    if (!row) {
        throw new Error(`${operation} returned no row`);
    }

    return row;
}

export const projectRepository = {
    // Newest first; `id` breaks ties so a page boundary never repeats or skips a row.
    async selectPage(limit: number, offset: number): Promise<ProjectRow[]> {
        const result = await pool.query<ProjectRow>(
            `SELECT ${PROJECT_COLUMNS}
               FROM projects
              ORDER BY created_at DESC, id DESC
              LIMIT $1 OFFSET $2`,
            [limit, offset],
        );

        return result.rows;
    },

    async countAll(): Promise<number> {
        const result = await pool.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM projects');

        return firstRowOrThrow(result.rows, 'COUNT projects').total;
    },

    async selectById(id: number): Promise<ProjectRow | undefined> {
        const result = await pool.query<ProjectRow>(
            `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1`,
            [id],
        );

        return result.rows[0];
    },

    async insert(project: ProjectFields): Promise<ProjectRow> {
        const result = await pool.query<ProjectRow>(
            `INSERT INTO projects (name, description, version, status)
             VALUES ($1, $2, $3, $4)
             RETURNING ${PROJECT_COLUMNS}`,
            [project.name, project.description, project.version, project.status],
        );

        return firstRowOrThrow(result.rows, 'INSERT project');
    },

    // undefined = no project with that id.
    async updateById(id: number, project: ProjectFields): Promise<ProjectRow | undefined> {
        const result = await pool.query<ProjectRow>(
            `UPDATE projects
                SET name = $2, description = $3, version = $4, status = $5, updated_at = now()
              WHERE id = $1
             RETURNING ${PROJECT_COLUMNS}`,
            [id, project.name, project.description, project.version, project.status],
        );

        return result.rows[0];
    },
};
