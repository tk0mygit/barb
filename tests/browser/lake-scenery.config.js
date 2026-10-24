import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../playwright.config.js';

// Optional, isolated main/PR review capture. The normal L2 suite discovers the
// scenery spec through its existing config and retains the usual diagnostics.
const port = Number(process.env.LAKE_SCENERY_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LAKE_SCENERY_PORT');
const sourceDirectory = resolve(process.env.LAKE_SCENERY_SOURCE_DIR ?? '.');
const baseURL = `http://127.0.0.1:${port}/barb/`;
export default { ...config,
  testDir: fileURLToPath(new URL('.', import.meta.url)), testMatch: 'lake-scenery.spec.js',
  outputDir: resolve(process.env.LAKE_SCENERY_OUTPUT_DIR ?? 'test-results/lake-scenery'),
  use: { ...config.use, baseURL },
  webServer: { command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, cwd: sourceDirectory,
    url: baseURL, reuseExistingServer: false },
};
