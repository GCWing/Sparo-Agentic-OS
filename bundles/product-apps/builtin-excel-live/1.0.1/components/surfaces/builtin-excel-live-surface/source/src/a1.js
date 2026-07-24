function colToIndex(col) {
  if (col == null || typeof col !== 'string' || !col.length) {
    throw new Error('Column letter is required');
  }
  const upper = col.toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) {
    throw new Error(`Invalid column letters: ${col}`);
  }
  let index = 0;
  for (let i = 0; i < upper.length; i += 1) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

function indexToCol(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid column index: ${index}`);
  }
  let n = index + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function parseCellToken(token) {
  const match = String(token || '')
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    throw new Error(`Invalid A1 cell reference: ${token}`);
  }
  return {
    c: colToIndex(match[1]),
    r: Number(match[2]) - 1,
  };
}

/**
 * Parse an A1 range or cell.
 * Accepts: "A1", "A1:B10", "Sheet1!A1:B2", "'My Sheet'!A1"
 */
function parseA1(ref) {
  if (ref == null || String(ref).trim() === '') {
    throw new Error('A1 reference is required');
  }
  let raw = String(ref).trim();
  let sheet = null;

  const bang = raw.lastIndexOf('!');
  if (bang >= 0) {
    sheet = raw.slice(0, bang).trim();
    raw = raw.slice(bang + 1).trim();
    if (
      (sheet.startsWith("'") && sheet.endsWith("'")) ||
      (sheet.startsWith('"') && sheet.endsWith('"'))
    ) {
      sheet = sheet.slice(1, -1).replace(/''/g, "'");
    }
  }

  const parts = raw.split(':');
  if (parts.length === 1) {
    const cell = parseCellToken(parts[0]);
    return { sheet, r1: cell.r, c1: cell.c, r2: cell.r, c2: cell.c };
  }
  if (parts.length !== 2) {
    throw new Error(`Invalid A1 range: ${ref}`);
  }
  const a = parseCellToken(parts[0]);
  const b = parseCellToken(parts[1]);
  return {
    sheet,
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  };
}

function formatA1(r1, c1, r2 = r1, c2 = c1) {
  if (
    !Number.isInteger(r1) ||
    !Number.isInteger(c1) ||
    !Number.isInteger(r2) ||
    !Number.isInteger(c2)
  ) {
    throw new Error('formatA1 requires integer row/col indices');
  }
  const top = Math.min(r1, r2);
  const left = Math.min(c1, c2);
  const bottom = Math.max(r1, r2);
  const right = Math.max(c1, c2);
  const start = `${indexToCol(left)}${top + 1}`;
  if (top === bottom && left === right) {
    return start;
  }
  return `${start}:${indexToCol(right)}${bottom + 1}`;
}

export { colToIndex, formatA1, indexToCol, parseA1 };
