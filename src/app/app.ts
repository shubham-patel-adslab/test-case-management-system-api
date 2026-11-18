import express from 'express';
import helmet from 'helmet';

import { errorHandler, notFoundHandler } from '../shared/error/error.middleware.js';
import { apiRouter } from './api.router.js';
import { env } from './env.js';

const JSON_BODY_LIMIT = '100kb';

export const app = express();

// Behind a proxy every request comes from the proxy's address; trusting its X-Forwarded-For gives req.ip the
// client's. Left at Express's default (trust none) otherwise, so a client can't spoof the header.
if (env.TRUST_PROXY_HOPS > 0) {
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
}

app.use(helmet());
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use('/api', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
