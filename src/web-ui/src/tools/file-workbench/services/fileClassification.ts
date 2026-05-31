import type { FsEntry } from '@/infrastructure/api';
import type { FileCapability, FileCategory, FileEntry, FileScope } from '../types';

export const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'rs', 'py', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php',
  'swift', 'kt', 'lua', 'r', 'scala', 'ex', 'exs', 'zig', 'nim',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf',
  'md', 'txt', 'sh', 'bash', 'bat', 'ps1', 'zsh', 'fish',
  'sql', 'graphql', 'gql', 'prisma',
  'env', 'dockerfile', 'gitignore', 'gitattributes', 'editorconfig', 'nvmrc', 'npmrc',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'opus']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'zst', 'tgz']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'epub']);
const SPARO_PREVIEW_CATEGORIES = new Set<FileCategory>(['text', 'image']);

export function getFileCategory(entry: FsEntry): FileCategory {
  if (entry.kind === 'dir') return 'folder';
  const nameLower = entry.name.toLowerCase();
  const ext = nameLower.split('.').pop() || '';
  const noExt = !nameLower.includes('.') || nameLower.startsWith('.');
  if (TEXT_PREVIEW_EXTENSIONS.has(ext) || (noExt && TEXT_PREVIEW_EXTENSIONS.has(nameLower))) return 'text';
  if (ext in IMAGE_MIME_TYPES) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return 'other';
}

export function canOpenInSparo(entry: FsEntry): boolean {
  return entry.kind !== 'dir' && SPARO_PREVIEW_CATEGORIES.has(getFileCategory(entry));
}

export function imageMimeTypeFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return IMAGE_MIME_TYPES[ext] || 'image/*';
}

export function getLangFamily(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (['ts', 'tsx'].includes(ext)) return 'ts';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'js';
  if (ext === 'rs') return 'rs';
  if (ext === 'py') return 'py';
  if (ext === 'go') return 'go';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'css';
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return 'cfg';
  if (['md', 'txt'].includes(ext)) return 'doc';
  return 'code';
}

export function extensionFromName(name: string): string | undefined {
  const normalized = name.toLowerCase();
  if (!normalized.includes('.') || normalized.startsWith('.')) return undefined;
  return normalized.split('.').pop() || undefined;
}

export function baseFileCapabilities(entry: FsEntry): FileCapability[] {
  const capabilities: FileCapability[] = ['preview', 'addToChat', 'askSparo', 'reveal', 'copyPath'];
  if (entry.kind === 'dir') {
    capabilities.push('openExternal', 'openAsWorkspace', 'summarize', 'organize', 'findDuplicates', 'operationPlan');
    return capabilities;
  }

  capabilities.push('openExternal', 'summarize');
  if (canOpenInSparo(entry)) capabilities.unshift('openInSparo');
  return capabilities;
}

export function fileEntryFromFsEntry(entry: FsEntry, scope: FileScope): FileEntry {
  const category = getFileCategory(entry);
  return {
    ...entry,
    id: `${scope.kind}:${entry.path}`,
    scope,
    category,
    extension: extensionFromName(entry.name),
    mimeType: category === 'image' ? imageMimeTypeFromPath(entry.path) : undefined,
    capabilities: baseFileCapabilities(entry),
  };
}
