import { Router } from 'express';

import { healthRouter } from '../features/health/health.routes.js';
import { projectRouter } from '../features/project/project.routes.js';
import { createDocsRouter } from './openapi.js';

export const apiRouter = Router();

// Public routes — no authentication.
apiRouter.use('/health', healthRouter);

// Feature routers go below. When the auth feature lands, its middleware is mounted here first, so
// every route after it is protected by default and only the routes above stay public.
apiRouter.use('/projects', projectRouter);

// Last: the docs are generated from everything the feature routers registered above.
apiRouter.use(createDocsRouter());
