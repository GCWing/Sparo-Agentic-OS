import { describe, expect, it } from 'vitest';
import { buildFileContextPack, toFilesContext } from './fileContextPackBuilder';
import { fileEntryFromFsEntry } from './fileClassification';
import type { FileEntry } from '../types';

const selection: FileEntry[] = [
  { path: '/work/readme.md', name: 'readme.md', kind: 'file', size: 100, readonly: false, hidden: false },
  { path: '/work/assets', name: 'assets', kind: 'dir', size: 0, readonly: false, hidden: false },
].map((entry) => fileEntryFromFsEntry(entry, { kind: 'workspace', root: '/work' }));

describe('fileContextPackBuilder', () => {
  it('builds a rich context pack for Filer and chat handoff', () => {
    const pack = buildFileContextPack({
      scope: { kind: 'workspace', root: '/work' },
      cwd: '/work',
      workspaceRoot: '/work',
      selection,
      recentlyOpenedPaths: ['/work'],
    });
    const context = toFilesContext(pack);

    expect(context.source).toBe('files-scene');
    expect(context.summary?.itemCount).toBe(2);
    expect(context.summary?.fileCount).toBe(1);
    expect(context.summary?.folderCount).toBe(1);
    expect(context.selection[0]).toMatchObject({ category: 'text', readonly: false });
    expect(context.capabilities).toContain('askSparo');
  });
});
