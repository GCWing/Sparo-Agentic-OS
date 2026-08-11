import { checkProductBrandAssets } from './sync-brand-assets.mjs';

checkProductBrandAssets().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
