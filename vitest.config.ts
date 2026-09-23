import { configDefaults, defineConfig } from 'vitest/config';

// The indexer runs its own tests after Envio's codegen (pnpm --filter @airbag/indexer test);
// e2e/ is Playwright's.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'indexer/**', 'e2e/**'] },
});
