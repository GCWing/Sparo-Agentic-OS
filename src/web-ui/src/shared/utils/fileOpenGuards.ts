import { detectLanguage } from '@/infrastructure/language-detection';

const UNSUPPORTED_BINARY_EXTENSIONS = new Set([
  'apk',
  'app',
  'class',
  'db',
  'deb',
  'doc',
  'docm',
  'docx',
  'dylib',
  'epub',
  'exe',
  'jar',
  'msi',
  'odf',
  'odp',
  'ods',
  'odt',
  'parquet',
  'pdf',
  'ppt',
  'pptm',
  'pptx',
  'rpm',
  'sqlite',
  'sqlite3',
  'wasm',
  'xls',
  'xlsm',
  'xlsx',
]);

export function getFileExtension(filePathOrName: string): string {
  const fileName = filePathOrName.split(/[/\\]/).pop() || '';
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return '';
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

export function isUnsupportedBinaryEditorFile(filePathOrName: string): boolean {
  const extension = getFileExtension(filePathOrName);
  if (UNSUPPORTED_BINARY_EXTENSIONS.has(extension)) {
    return true;
  }

  const detection = detectLanguage(filePathOrName);
  const { category, iconType } = detection.language;
  if (category === 'binary') {
    return true;
  }

  return category === 'media' && iconType !== 'image';
}

export function formatFileSize(bytes?: number): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
}
