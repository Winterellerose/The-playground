// Classic browser scripts intentionally share globals across files. Keep lint
// focused on correctness; Prettier owns formatting (no legacy style churn).
module.exports = [
  { ignores: ['js/vendor/**', 'docs/**', 'node_modules/**', '.vendor-tmp/**', 'test-results/**', 'playwright-report/**'] },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest' },
    rules: {
      'no-dupe-args': 'error', 'no-dupe-keys': 'error',
      'no-unreachable': 'error', 'valid-typeof': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-async-promise-executor': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: { 'no-restricted-globals': ['error', { name: 'require', message: 'Use ESM imports in .js/.mjs files.' }] },
  },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
];
