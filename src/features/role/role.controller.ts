import type { Request, Response } from 'express';

import { roleService } from './role.service.js';

// HTTP ↔ service mapping only.
export const roleController = {
    async getList(_req: Request, res: Response): Promise<void> {
        res.json(await roleService.getActiveRoles());
    },
};
