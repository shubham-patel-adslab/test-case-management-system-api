import { Router } from 'express';

import { authenticate } from '../features/authentication/authentication.middleware.js';
import { authenticationRouter } from '../features/authentication/authentication.routes.js';
import { authorizationRouter } from '../features/authorization/authorization.routes.js';
import { healthRouter } from '../features/health/health.routes.js';
import { invitationRouter } from '../features/invitation/invitation.routes.js';
import { projectRouter } from '../features/project/project.routes.js';
import { roleRouter } from '../features/role/role.routes.js';
import { userRouter } from '../features/user/user.routes.js';
import { createDocsRouter } from './openapi.js';

export const apiRouter = Router();

// Mounted before the global `authenticate`. Health, docs, sign-in, sign-out and accepting an invitation
// are public; /auth/me authenticates per route. The docs can be built here already: the imports above ran every feature's
// registerPath calls before this line.
apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authenticationRouter);
apiRouter.use('/invitations', invitationRouter);
apiRouter.use(createDocsRouter());

// Everything below requires a valid access-token cookie for an active user (protected by default: a new
// router can't be left open by forgetting a middleware). Permission checks — authorize(resource,
// permission) — live on each route in the feature's routes file.
apiRouter.use(authenticate);

apiRouter.use('/authorization', authorizationRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/roles', roleRouter);
apiRouter.use('/projects', projectRouter);
