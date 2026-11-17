import bcrypt from 'bcryptjs';

import { BCRYPT_COST } from './user.constant.js';

// The one place a password is hashed (user creation via the API and the admin script), so the cost factor
// can't differ between them. Async API only: the sync one would block the event loop for ~270 ms.
export function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_COST);
}
