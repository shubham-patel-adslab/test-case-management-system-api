import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from './env.js';

// Where uploaded files live: local disk for now (decided 2026-11-17). This module is the only code that
// knows that — moving to an object store later replaces these functions, not their callers.
const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);

// Files are stored under a random name the server generates — never the client's name — so a name can't
// escape the directory (../), overwrite another file, or be guessed.
export function createStoredName(): string {
    return randomUUID();
}

function toPath(storedName: string): string {
    return path.join(UPLOAD_ROOT, storedName);
}

// The directory is created on first use, so a fresh environment needs no manual step.
export async function saveFile(storedName: string, content: Buffer): Promise<void> {
    await mkdir(UPLOAD_ROOT, { recursive: true });
    // 'wx': fail rather than overwrite if the name somehow exists.
    await writeFile(toPath(storedName), content, { flag: 'wx' });
}

// Removing a file that is already gone is not an error (cleanup after a failed save, test teardown).
export async function deleteFile(storedName: string): Promise<void> {
    try {
        await unlink(toPath(storedName));
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }
}

// For res.sendFile: the directory and the name within it (sendFile refuses paths outside `root`).
export function storedFileLocation(storedName: string): { root: string; fileName: string } {
    return { root: UPLOAD_ROOT, fileName: storedName };
}
