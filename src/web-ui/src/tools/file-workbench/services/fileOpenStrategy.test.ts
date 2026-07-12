import { describe, expect, it } from 'vitest';
import { decideFileOpenAction, getEntryCapabilities } from './fileOpenStrategy';
import { fileEntryFromFsEntry } from './fileClassification';
import type { FileEntry } from '../types';

const textEntry: FileEntry = fileEntryFromFsEntry({
  path: '/work/readme.md',
  name: 'readme.md',
  kind: 'file',
  size: 64,
  readonly: false,
  hidden: false,
}, { kind: 'workspace', root: '/work' });

const folderEntry: FileEntry = fileEntryFromFsEntry({
  path: '/work/docs',
  name: 'docs',
  kind: 'dir',
  size: 0,
  readonly: false,
  hidden: false,
}, { kind: 'workspace', root: '/work' });

function fileEntry(name: string): FileEntry {
  return fileEntryFromFsEntry({
    path: `/work/${name}`,
    name,
    kind: 'file',
    size: 64,
    readonly: false,
    hidden: false,
  }, { kind: 'workspace', root: '/work' });
}

describe('fileOpenStrategy', () => {
  it('prefers Sparo for previewable files', () => {
    expect(decideFileOpenAction(textEntry).primary).toBe('openInSparo');
    expect(getEntryCapabilities(textEntry)).toContain('openInSparo');
  });

  it('navigates folders and exposes workspace actions', () => {
    const decision = decideFileOpenAction(folderEntry);
    expect(decision.primary).toBe('openFolder');
    expect(decision.capabilities).toContain('openAsWorkspace');
  });

  it.each(['book.xlsx', 'macro.xlsm', 'data.csv'])('routes supported spreadsheet %s to Excel Live', (name) => {
    const decision = decideFileOpenAction(fileEntry(name));
    expect(decision.primary).toBe('openInExcelLive');
    expect(decision.capabilities).toContain('openInExcelLive');
  });

  it.each(['data.tsv', 'book.ods', 'legacy.xls'])('does not advertise unsupported spreadsheet %s', (name) => {
    const decision = decideFileOpenAction(fileEntry(name));
    expect(decision.primary).not.toBe('openInExcelLive');
    expect(decision.capabilities).not.toContain('openInExcelLive');
  });
});
