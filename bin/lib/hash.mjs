import { createHash } from 'node:crypto';

export function sha256Hex(data) { return createHash('sha256').update(data).digest('hex'); }

export function sha256Tagged(data) { return 'sha256:' + sha256Hex(data); }
