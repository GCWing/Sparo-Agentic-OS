const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const pptxgen = require('pptxgenjs');
const html2pptx = require('./html2pptx.cjs');

/**
 * Agent/skill CLI: convert a directory of constraint-compliant HTML slides to editable PPTX.
 * Runtime is fully bundled — no npm install at execution time.
 */
async function exportDeckPptx(slidesDir, outFile) {
  const resolvedDir = path.resolve(slidesDir);
  const resolvedOut = path.resolve(outFile);
  const files = (await fsp.readdir(resolvedDir))
    .filter((name) => name.endsWith('.html'))
    .sort();
  if (!files.length) {
    throw new Error(`No .html files found in ${resolvedDir}`);
  }

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';

  const errors = [];
  for (let i = 0; i < files.length; i += 1) {
    const name = files[i];
    const fullPath = path.join(resolvedDir, name);
    try {
      await html2pptx(fullPath, pres);
      process.stdout.write(`  [${i + 1}/${files.length}] ${name} ok\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`  [${i + 1}/${files.length}] ${name} failed: ${message}\n`);
      errors.push({ file: name, error: message });
    }
  }

  if (errors.length === files.length) {
    const detail = errors.map((item) => `${item.file}: ${item.error}`).join('\n');
    throw new Error(`All slides failed to convert:\n${detail}`);
  }

  await pres.writeFile({ fileName: resolvedOut });
  return { slideCount: files.length, failed: errors };
}

module.exports = { exportDeckPptx };
