import { describe, expect, it } from 'vitest';
import { applyFileSelection, keepVisibleSelection, selectAllFiles } from './selectionController';
import { fileEntryFromFsEntry } from './fileClassification';
import type { FileEntry } from '../types';

const entries: FileEntry[] = [
  { path: '/work/a.ts', name: 'a.ts', kind: 'file', size: 10, readonly: false, hidden: false },
  { path: '/work/b.ts', name: 'b.ts', kind: 'file', size: 20, readonly: false, hidden: false },
  { path: '/work/c', name: 'c', kind: 'dir', size: 0, readonly: false, hidden: false },
].map((entry) => fileEntryFromFsEntry(entry, { kind: 'workspace', root: '/work' }));

describe('selectionController', () => {
  it('applies single, additive, and range selection predictably', () => {
    const single = applyFileSelection(entries, { selectedEntries: [], anchorPath: null }, entries[0], {
      additive: false,
      range: false,
    });
    expect(single.selectedEntries.map((entry) => entry.path)).toEqual(['/work/a.ts']);
    expect(single.anchorPath).toBe('/work/a.ts');

    const additive = applyFileSelection(entries, single, entries[1], {
      additive: true,
      range: false,
    });
    expect(additive.selectedEntries.map((entry) => entry.path)).toEqual(['/work/a.ts', '/work/b.ts']);

    const range = applyFileSelection(entries, additive, entries[2], {
      additive: false,
      range: true,
    });
    expect(range.selectedEntries.map((entry) => entry.path)).toEqual(['/work/b.ts', '/work/c']);
  });

  it('keeps selection stable when the visible list changes', () => {
    expect(selectAllFiles(entries).anchorPath).toBe('/work/a.ts');
    expect(keepVisibleSelection(entries, [entries[1]]).map((entry) => entry.path)).toEqual(['/work/b.ts']);
  });
});
