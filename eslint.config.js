import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Regla de 3: cuando corrijas lo mismo 3 veces en review, agrégalo aquí
// para que el build falle en vez de depender de que el agente "se acuerde".
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      'no-console': ['error', { allow: ['error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'hack'], location: 'anywhere' }],
    },
  },
);
