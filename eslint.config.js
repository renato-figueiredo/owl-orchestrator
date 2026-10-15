import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', 'references/**', 'node_modules/**', '**/*.d.ts'] },
  ...tseslint.configs.recommended,
);
