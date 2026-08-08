/**
 * Image processing utility functions
 */

import type { ImageContext } from '@/shared/types/context';
import { registerMemoryImageAsset } from '@/shared/media/imageAssetStore';
import { imageMimeTypeFromPath, isImageFilename } from '@/shared/media/imageFormats';
import { createBinaryAttachmentIdentity } from '@/shared/context-system/attachmentIdentity';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('imageUtils');

/**
 * Build a human-readable, unique-ish filename for an image that came from the
 * clipboard (which has no real path). We deliberately avoid an incrementing
 * `image-N` counter because that name used to leak into the prompt and made
 * the model believe a file named `image-1.png` actually existed on disk.
 */
function generateClipboardImageName(mimeType: string): string {
  const ext = (mimeType.split('/')[1] || 'png').toLowerCase();
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${pad(now.getMilliseconds(), 3)}`;
  return `clipboard-${stamp}.${ext}`;
}

interface InspectedImageFile {
  width: number;
  height: number;
  thumbnailUrl: string;
}

async function inspectAndIdentifyImage(file: File): Promise<{
  inspection?: InspectedImageFile;
  identity?: ImageContext['identity'];
}> {
  const [inspectionResult, identityResult] = await Promise.allSettled([
    inspectImageFile(file, 200),
    createBinaryAttachmentIdentity(file),
  ]);
  if (inspectionResult.status === 'rejected') {
    log.warn('Failed to inspect image', { fileName: file.name, error: inspectionResult.reason });
  }
  if (identityResult.status === 'rejected') {
    log.warn('Failed to identify image', { fileName: file.name, error: identityResult.reason });
  }
  return {
    inspection: inspectionResult.status === 'fulfilled' ? inspectionResult.value : undefined,
    identity: identityResult.status === 'fulfilled' ? identityResult.value : undefined,
  };
}

function inspectImageFile(file: File, maxSize: number): Promise<InspectedImageFile> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(objectUrl);

    image.onload = () => {
      try {
        const naturalWidth = image.naturalWidth || image.width;
        const naturalHeight = image.naturalHeight || image.height;
        const scale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
        const thumbnailWidth = Math.max(1, Math.round(naturalWidth * scale));
        const thumbnailHeight = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Failed to get canvas context');

        canvas.width = thumbnailWidth;
        canvas.height = thumbnailHeight;
        context.drawImage(image, 0, 0, thumbnailWidth, thumbnailHeight);
        resolve({
          width: naturalWidth,
          height: naturalHeight,
          thumbnailUrl: canvas.toDataURL('image/jpeg', 0.8),
        });
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Image loading failed'));
    };
    image.decoding = 'async';
    image.src = objectUrl;
  });
}

/**
 * Generate image thumbnail
 * @param file Image file
 * @param maxSize Maximum size (default 200px)
 * @returns Base64 encoded thumbnail
 */
export async function generateThumbnail(
  file: File,
  maxSize: number = 200
): Promise<string> {
  return (await inspectImageFile(file, maxSize)).thumbnailUrl;
}

/**
 * Generate thumbnail from file path (Tauri environment)
 * @param filePath File path
 * @returns Base64 encoded thumbnail
 */
export async function generateThumbnailFromPath(
  filePath: string
): Promise<string> {
  // In a Tauri environment, the backend can generate thumbnails.
  // Here we simplify the process and return the file path directly.
  // TODO: Implement backend thumbnail generation
  return `file://${filePath}`;
}

/**
 * Validate image file
 * @param file File object
 * @returns Validation result
 */
export function validateImageFile(file: File): {
  valid: boolean;
  error?: string;
} {
  const supportedTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp'
  ];
  
  if (!supportedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported image format: ${file.type}`
    };
  }
  
  const maxSize = 20 * 1024 * 1024;
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `Image too large (${(file.size / 1024 / 1024).toFixed(2)}MB), maximum supported 20MB`
    };
  }
  
  return { valid: true };
}

/**
 * Get image dimensions
 * @param file Image file
 * @returns Image width and height
 */
export async function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  const inspected = await inspectImageFile(file, 1);
  return { width: inspected.width, height: inspected.height };
}

/**
 * Get MIME type from filename
 * @param filename Filename
 * @returns MIME type
 */
export function getMimeTypeFromFilename(filename: string): string {
  return imageMimeTypeFromPath(filename, 'image/jpeg');
}

/**
 * Create ImageContext from file
 * @param file File object
 * @returns ImageContext
 */
export async function createImageContextFromFile(
  file: File
): Promise<ImageContext> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  const { inspection, identity } = await inspectAndIdentifyImage(file);
  
  const id = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const imagePath = (file as File & { path?: string }).path || '';
  const imageContext: ImageContext = {
    id,
    type: 'image',
    imageName: file.name,
    width: inspection?.width,
    height: inspection?.height,
    fileSize: file.size,
    mimeType: file.type,
    source: 'file',
    identity,
    sourceRef: imagePath
      ? { kind: 'local-file', path: imagePath }
      : registerMemoryImageAsset(id, file),
    timestamp: Date.now(),
    thumbnailUrl: inspection?.thumbnailUrl,
    metadata: {}
  };

  return imageContext;
}

/**
 * Create ImageContext from clipboard
 * @param file File object from clipboard
 * @returns ImageContext
 */
export async function createImageContextFromClipboard(
  file: File
): Promise<ImageContext> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  const { inspection, identity } = await inspectAndIdentifyImage(file);
  
  const id = `img-clipboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const imageContext: ImageContext = {
    id,
    type: 'image',
    imageName: (() => {
      const raw = file.name || '';
      const genericPattern = /^image\.\w+$/i;
      if (!raw || genericPattern.test(raw)) {
        return generateClipboardImageName(file.type || 'image/png');
      }
      return raw;
    })(),
    width: inspection?.width,
    height: inspection?.height,
    fileSize: file.size,
    mimeType: file.type,
    source: 'clipboard',
    identity,
    sourceRef: registerMemoryImageAsset(id, file),
    timestamp: Date.now(),
    thumbnailUrl: inspection?.thumbnailUrl,
    metadata: {
      fromClipboard: true
    }
  };
  
  return imageContext;
}

/**
 * Check if file is an image
 * Use global language detection service
 * @param filename Filename
 * @returns Whether it is an image
 */
export function isImageFile(filename: string): boolean {
  return isImageFilename(filename);
}

/**
 * Format file size
 * @param bytes Bytes
 * @returns Formatted string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

