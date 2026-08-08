import { describe, expect, it } from 'vitest';
import { basenamePath, dirnameAbsolutePath } from './pathUtils';

describe('filesystem path segments', () => {
  it('reads basenames with either path separator', () => {
    expect(basenamePath('D:/workspace/file.ts')).toBe('file.ts');
    expect(basenamePath('D:\\workspace\\file.ts')).toBe('file.ts');
  });

  it('preserves Unix and Windows roots when reading a parent', () => {
    expect(dirnameAbsolutePath('/file.ts')).toBe('/');
    expect(dirnameAbsolutePath('D:/file.ts')).toBe('D:/');
    expect(dirnameAbsolutePath('D:\\file.ts')).toBe('D:\\');
  });

  it('returns an empty parent for a relative basename', () => {
    expect(dirnameAbsolutePath('file.ts')).toBe('');
  });
});
