import { createHash } from 'node:crypto';

export function sha256Hex(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex'); }

export function sha256Tagged(data: string | Buffer): string { return 'sha256:' + sha256Hex(data); }
