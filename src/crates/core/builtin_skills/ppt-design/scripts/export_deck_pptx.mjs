#!/usr/bin/env node
/**
 * export_deck_pptx.mjs — 把多文件 slide deck 导出为可编辑 PPTX（Agent/Skill CLI）
 *
 * 用法：
 *   node export_deck_pptx.mjs --slides <dir> --out <file.pptx>
 *
 * 运行时依赖已打进同目录 skill-export-pptx.bundle.cjs（构建时生成，无需 npm install）。
 * 终端用户请使用演示稿界面「导出」，不要跑本脚本。
 *
 * ⚠️ HTML 必须符合 4 条硬约束（见 references/editable-pptx.md）。
 */

import { existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function parseArgs() {
  const args = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '');
    args[k] = a[i + 1];
  }
  if (!args.slides || !args.out) {
    console.error('用法: node export_deck_pptx.mjs --slides <dir> --out <file.pptx>');
    console.error('');
    console.error('⚠️ HTML 必须符合 4 条硬约束（见 references/editable-pptx.md）。');
    console.error('   终端用户请使用演示稿界面「导出」，无需本脚本。');
    process.exit(1);
  }
  return args;
}

function loadSkillExportRuntime() {
  const bundlePath = path.join(__dirname, 'skill-export-pptx.bundle.cjs');
  if (!existsSync(bundlePath)) {
    throw new Error(
      `Missing bundled export runtime at ${bundlePath}. `
      + 'Run pnpm run bundle:ppt-live-export from the Sparo repository (maintainers only).',
    );
  }
  return require(bundlePath);
}

async function main() {
  const { slides, out } = parseArgs();
  const slidesDir = path.resolve(slides);
  const outFile = path.resolve(out);

  let exportDeckPptx;
  try {
    ({ exportDeckPptx } = loadSkillExportRuntime());
  } catch (error) {
    console.error(`✗ PPT export runtime unavailable: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  console.log(`Converting slides in ${slidesDir}...`);

  try {
    const result = await exportDeckPptx(slidesDir, outFile);
    const failed = result?.failed?.length || 0;
    if (failed > 0) {
      console.error(`\n⚠️ ${failed} slide(s) failed:`);
      for (const item of result.failed) {
        console.error(`  ${item.file}: ${item.error}`);
      }
    }
    console.log(`\n✓ Wrote ${outFile} (${result.slideCount - failed}/${result.slideCount} slides, editable PPTX)`);
  } catch (error) {
    console.error(`✗ Export failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
