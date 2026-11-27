import { existsSync } from 'node:fs';
import { join } from 'node:path';

const tsc = join(import.meta.dirname, 'node_modules/typescript/bin/tsc');
if (!existsSync(tsc)) {
  console.error('Run npm ci --ignore-scripts in tooling/ to install the TypeScript compiler.');
  process.exitCode = 1;
}
