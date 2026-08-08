/**
 * Content-related type definitions.
 * Reuses the shared FlexiblePanel content contract.
 */

export type { PanelContentType, PanelContent } from '../../base/types';
import type { PanelContentType } from '../../base/types';

/**
 * File viewer types (code, markdown, images, etc.).
 */
export const FILE_VIEWER_TYPES: PanelContentType[] = [
  'code-preview',
  'code-viewer',
  'code-editor',
  'markdown-viewer',
  'markdown-editor',
  'text-viewer',
  'file-viewer',
  'image-viewer',
  'diff-code-editor',
  'plan-viewer',
];

/**
 * Check whether a content type is a file viewer.
 */
export const isFileViewerType = (type: PanelContentType): boolean => {
  return FILE_VIEWER_TYPES.includes(type);
};

/**
 * Options for creating a tab.
 */
export interface CanvasItemDescriptor {
  /** Content type */
  type: PanelContentType;
  /** Title */
  title: string;
  /** Data */
  data?: any;
  /** Metadata */
  metadata?: Record<string, any>;
  /** Duplicate check key */
  duplicateCheckKey?: string;
  /** Whether to replace existing tab */
  replaceExisting?: boolean;
  /** Target editor group */
  targetGroup?: 'primary' | 'secondary';
  /** Enable split view (auto-switch to horizontal split) */
  enableSplitView?: boolean;
}
