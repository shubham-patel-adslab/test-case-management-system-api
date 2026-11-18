import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { defectController } from './defect.controller.js';
import { defectCreateRequestSchema, defectExecutionParamsSchema } from './defect.request.dto.js';
import { defectDetailsResponseSchema } from './defect.response.dto.js';

// Mounted at /projects/:projectId/test-executions/:executionId/defects in api.router.ts (behind authenticate),
// with mergeParams. PRD: tester, test-lead and admin create defects (DEFECT CREATE); the service then checks
// the project is in the caller's scope.
export const defectRouter = Router({ mergeParams: true });

defectRouter.post('/', authorize(RESOURCE_CODE.DEFECT, PERMISSION_CODE.CREATE), defectController.create);

openApiRegistry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/test-executions/{executionId}/defects',
    tags: ['Defects'],
    summary: 'Create a defect from a failed execution',
    description: 'Only from an execution whose result is FAIL, and one per execution (409 otherwise). The execution then shows it '
        + '(`defect`), and its audit trail records DEFECT_CREATED.',
    request: { params: defectExecutionParamsSchema, body: { content: jsonContent(defectCreateRequestSchema) } },
    responses: {
        201: { description: 'The defect', content: jsonContent(defectDetailsResponseSchema) },
        400: errorResponse('Invalid request'),
        401: errorResponse('Missing, invalid or expired access-token cookie, or inactive account'),
        403: errorResponse('Missing permission DEFECT CREATE (code FORBIDDEN)'),
        404: errorResponse('Project or test execution not found (or the caller is not a member of the project)'),
        409: errorResponse('The execution is not FAIL, or already has a defect'),
    },
});
