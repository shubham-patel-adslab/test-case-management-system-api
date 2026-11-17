import { Router } from 'express';

import { attachmentRouter, executionAttachmentRouter } from '../features/attachment/attachment.routes.js';
import { authenticate } from '../features/authentication/authentication.middleware.js';
import { authenticationRouter } from '../features/authentication/authentication.routes.js';
import { authorizationRouter } from '../features/authorization/authorization.routes.js';
import { defectRouter } from '../features/defect/defect.routes.js';
import { healthRouter } from '../features/health/health.routes.js';
import { invitationRouter } from '../features/invitation/invitation.routes.js';
import { projectRouter } from '../features/project/project.routes.js';
import { roleRouter } from '../features/role/role.routes.js';
import { suiteRunRouter, testSuiteRunRouter } from '../features/suite-run/suite-run.routes.js';
import { testCaseRouter } from '../features/test-case/test-case.routes.js';
import { testExecutionRouter } from '../features/test-execution/test-execution.routes.js';
import { testSuiteRouter } from '../features/test-suite/test-suite.routes.js';
import { userRouter } from '../features/user/user.routes.js';
import { createDocsRouter } from './openapi.js';

export const apiRouter = Router();

// Mounted before the global `authenticate`. Health, docs, sign-in, sign-out and checking or accepting an
// invitation are public; /auth/me authenticates per route. The docs can be built here already: the imports above ran every feature's
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
// Project-scoped features: nested under their project, so every request names it (api-requirements §2).
apiRouter.use('/projects/:projectId/test-cases', testCaseRouter);
apiRouter.use('/projects/:projectId/test-suites/:suiteId/runs', testSuiteRunRouter);
apiRouter.use('/projects/:projectId/test-suites', testSuiteRouter);
apiRouter.use('/projects/:projectId/test-executions/:executionId/defects', defectRouter);
apiRouter.use('/projects/:projectId/test-executions/:executionId/attachments', executionAttachmentRouter);
apiRouter.use('/projects/:projectId/test-executions', testExecutionRouter);
apiRouter.use('/projects/:projectId/suite-runs', suiteRunRouter);
apiRouter.use('/projects/:projectId/attachments', attachmentRouter);
apiRouter.use('/projects', projectRouter);
