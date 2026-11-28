import { launch } from '../bin/lib/node-floor.mjs';
launch(import.meta.url, false);
const { main } = await import('./deps.ts');
main();
