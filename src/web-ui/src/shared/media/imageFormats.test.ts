import { describe, expect, it } from 'vitest';
import { fileExtension, imageMimeTypeFromPath, isImageFilename } from './imageFormats';

describe('imageFormats', () => {
  it('normalizes extensions across Windows and POSIX paths', () => {
    expect(fileExtension('C:\\images\\preview.JPEG')).toBe('jpeg');
    expect(fileExtension('/images/archive.tar.png')).toBe('png');
  });

  it('recognizes every supported image family through one shared table', () => {
    expect(isImageFilename('scan.TIFF')).toBe(true);
    expect(isImageFilename('icon.svg')).toBe(true);
    expect(isImageFilename('notes.txt')).toBe(false);
  });

  it('returns a caller-controlled fallback for unknown formats', () => {
    expect(imageMimeTypeFromPath('photo.avif')).toBe('image/avif');
    expect(imageMimeTypeFromPath('README', 'application/octet-stream')).toBe(
      'application/octet-stream',
    );
  });
});
