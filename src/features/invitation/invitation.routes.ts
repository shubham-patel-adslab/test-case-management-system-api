import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry, tooManyRequestsResponse } from '../../app/openapi.js';
import { RATE_LIMIT } from '../../app/rate-limit.js';
import { invitationController } from './invitation.controller.js';
import { invitationAcceptRequestSchema, invitationVerifyRequestSchema } from './invitation.request.dto.js';

// Public: the invited user has no account access yet — the token is the proof. Invitations are created and
// re-sent through /users.
export const invitationRouter = Router();

invitationRouter.post('/verify', invitationController.verify);
invitationRouter.post('/accept', invitationController.accept);

const authRateLimitedResponse = tooManyRequestsResponse(RATE_LIMIT.AUTH, 'IP', 'sign-in and invitation-accept');

const invalidInvitationResponse = errorResponse('Invalid request, or INVALID_INVITATION (unknown, used, replaced or expired link)');

openApiRegistry.registerPath({
    method: 'post',
    path: '/invitations/verify',
    tags: ['Invitations'],
    summary: 'Check an invitation link without using it',
    description: 'For the set-password page, when it opens. Read-only: the token stays usable for /invitations/accept. '
        + 'POST so the token stays in the body, out of URLs and logs.',
    security: [],
    request: { body: { content: jsonContent(invitationVerifyRequestSchema) } },
    responses: {
        204: { description: 'Link can be used' },
        400: invalidInvitationResponse,
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: '/invitations/accept',
    tags: ['Invitations'],
    summary: 'Set the first password from an invitation link',
    description: 'The token comes from the emailed link (`/set-password#token=…`). It works once and expires; '
        + 'on success the user is ACTIVE and signs in with the new password.',
    security: [],
    request: { body: { content: jsonContent(invitationAcceptRequestSchema) } },
    responses: {
        204: { description: 'Password set; the user can sign in' },
        400: invalidInvitationResponse,
        429: authRateLimitedResponse,
    },
});
