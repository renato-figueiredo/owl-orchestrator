import { defineConfig } from 'vitest/config';

// Web tests opt into jsdom with a `// @vitest-environment jsdom` docblock; everything else runs in Node.
export default defineConfig({ test: { include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}'] } });
