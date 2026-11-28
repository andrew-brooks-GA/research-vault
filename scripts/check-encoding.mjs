import { launch } from '../bin/lib/node-floor.mjs';
launch(import.meta.url, false);
await import('./check-encoding.ts');
