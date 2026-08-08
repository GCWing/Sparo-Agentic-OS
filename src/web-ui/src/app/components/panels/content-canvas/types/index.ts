/**
 * Unified exports for ContentCanvas types.
 */

// Tab-related types
export type {
  TabState,
  CanvasTab,
  EditorGroupState,
  TabDragPayload,
  TabActions,
  TabVisualProps,
  ClosedTabRecord,
} from './tab';

export { generateTabId, createTab } from './tab';

// Layout-related types
export type {
  SplitMode,
  AnchorPosition,
  DropPosition,
  EditorGroupId,
  LayoutState,
  CanvasState,
  CanvasPersistState,
} from './layout';

export {
  LAYOUT_CONFIG,
  createEditorGroupState,
  createLayoutState,
  createCanvasState,
  clampSplitRatio,
  clampAnchorSize,
} from './layout';

// Content-related types
export type {
  PanelContentType,
  PanelContent,
  CanvasItemDescriptor,
} from './content';

export {
  FILE_VIEWER_TYPES,
  isFileViewerType,
} from './content';
