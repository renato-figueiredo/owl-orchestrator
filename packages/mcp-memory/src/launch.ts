import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * How to start `bin.ts`. The workspace packages export TypeScript, so it runs through tsx. The CLI starts the server in
 * the PROJECT folder, and tsx reads the `tsconfig.json` of the working directory (its `paths` can redirect imports): the
 * repository's own tsconfig is passed explicitly so nothing in the project folder can change what the server loads.
 */
export function memoryServerLaunch(): { command: string; args: string[] } {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  return {
    command: process.execPath,
    args: [
      tsx,
      '--tsconfig',
      fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
      fileURLToPath(new URL('./bin.ts', import.meta.url)),
    ],
  };
}
