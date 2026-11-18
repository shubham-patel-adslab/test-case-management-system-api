import path from 'node:path';

import { fileTypeFromBuffer } from 'file-type';

import { ATTACHMENT_BINARY_MIME_TYPES, ATTACHMENT_TEXT_TYPES } from './attachment.constant.js';

const allowedBinaryTypes: readonly string[] = ATTACHMENT_BINARY_MIME_TYPES;
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function isText(content: Buffer): boolean {
    if (content.includes(0)) {
        return false;
    }

    try {
        strictUtf8.decode(content);

        return true;
    } catch {
        return false;
    }
}

// The type a file is stored and served with, decided from its content (PRD "Secure file upload"), or
// undefined when it isn't an allowed type. A renamed executable (.exe → .png) is detected as what it is and
// rejected; a binary file named .txt fails the text check; a text file named .png isn't a PNG.
export async function detectAllowedMimeType(content: Buffer, originalName: string): Promise<string | undefined> {
    const detected = await fileTypeFromBuffer(content);

    if (detected) {
        return allowedBinaryTypes.includes(detected.mime) ? detected.mime : undefined;
    }

    const textType = ATTACHMENT_TEXT_TYPES[path.extname(originalName).toLowerCase()];

    return textType !== undefined && isText(content) ? textType : undefined;
}
