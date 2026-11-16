import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { z } from 'zod';

const OPENAPI_VERSION = '3.1.0';
const API_VERSION = '1.0.0';

// Each feature registers its own paths here, next to its routes, so the docs are built from the
// same zod schemas that validate requests.
export const openApiRegistry = new OpenAPIRegistry();

// Shorthand for a JSON request/response body in registerPath calls.
export function jsonContent(schema: z.ZodType) {
    return { 'application/json': { schema } };
}

// Must be called after every feature module has been imported (i.e. after their registerPath calls
// ran), which is why this is a function rather than a document built at import time.
export function createDocsRouter(): Router {
    const document = new OpenApiGeneratorV31(openApiRegistry.definitions).generateDocument({
        openapi: OPENAPI_VERSION,
        info: {
            title: 'TCMS API',
            version: API_VERSION,
            description: 'Test Case Management System API',
        },
        servers: [{ url: '/api' }],
    });

    const docsRouter = Router();

    docsRouter.get('/docs.json', (_req, res) => {
        res.json(document);
    });
    docsRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(document));

    return docsRouter;
}
