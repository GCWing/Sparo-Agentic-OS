export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
};

export function fileExtension(pathOrName: string): string | undefined {
  const basename = pathOrName.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (!basename.includes('.') || basename.endsWith('.')) return undefined;
  return basename.split('.').pop() || undefined;
}

export function isImageFilename(pathOrName: string): boolean {
  const extension = fileExtension(pathOrName);
  return extension !== undefined && extension in IMAGE_MIME_TYPES;
}

export function imageMimeTypeFromPath(pathOrName: string, fallback = 'image/*'): string {
  const extension = fileExtension(pathOrName);
  return (extension && IMAGE_MIME_TYPES[extension]) || fallback;
}
