import type { FileEntry } from '../types';

export type FilePreviewState =
  | { status: 'empty' }
  | { status: 'metadata'; entry: FileEntry }
  | { status: 'text'; entry: FileEntry; text: string; truncated: boolean }
  | { status: 'image'; entry: FileEntry; url?: string }
  | { status: 'unavailable'; entry: FileEntry; reason: string };

export function getInitialPreviewState(entry: FileEntry | null): FilePreviewState {
  if (!entry) return { status: 'empty' };
  if (entry.category === 'text') return { status: 'metadata', entry };
  if (entry.category === 'image') return { status: 'image', entry };
  if (entry.category === 'folder') return { status: 'metadata', entry };
  return { status: 'unavailable', entry, reason: 'No rich preview is available for this file type yet.' };
}
