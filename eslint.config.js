import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', 'references/**', 'design/**','node_modules/**', '**/*.d.ts'] },
  ...tseslint.configs.recommended,
);
