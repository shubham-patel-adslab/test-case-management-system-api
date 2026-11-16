import express from 'express';
import helmet from 'helmet';

import { errorHandler, notFoundHandler } from '../shared/error/error.middleware.js';
import { apiRouter } from './api.router.js';

const JSON_BODY_LIMIT = '100kb';

export const app = express();

app.use(helmet());
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use('/api', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
