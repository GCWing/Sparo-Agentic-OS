#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const modeFlagIndex = args.findIndex(arg => arg === '--mode' || arg === '-m');
let mode = process.env.SPARO_E2E_APP_MODE || 'debug';

if (modeFlagIndex >= 0) {
  const next = args[modeFlagIndex + 1];
  if (!next) {
    console.error('Missing value for --mode. Use debug or dev.');
    process.exit(1);
  }
  mode = next;
  args.splice(modeFlagIndex, 2);
}

const spec = args[0];
if (!spec) {
  console.error('Usage: pnpm run e2e:test:spec -- <spec-file> [--mode debug|dev]');
  console.error('Example: pnpm run e2e:test:spec -- tests/e2e/specs/l0-open-settings.spec.ts');
  process.exit(1);
}

const normalizedSpec = spec.replace(/\\/g, '/').replace(/^tests\/e2e\//, './');

const child = spawn(
  'pnpm',
  ['--dir', 'tests/e2e', 'exec', 'wdio', 'run', './config/wdio.conf.ts', '--spec', normalizedSpec],
  {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      SPARO_E2E_APP_MODE: mode,
    },
  },
);

child.on('exit', code => {
  process.exit(code ?? 1);
});
