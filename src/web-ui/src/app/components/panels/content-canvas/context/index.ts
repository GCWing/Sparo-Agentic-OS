/**
 * Unified exports for context module.
 */

export {
  useCanvas,
  useEditorGroup,
  useCanvasLayout,
  useTabActions,
  useDragState,
  default as CanvasContext,
} from './CanvasContext';
export { CanvasProvider } from './CanvasProvider';

export type {
  CanvasContextValue,
  TabOperations,
  DragOperations,
  LayoutOperations,
} from './CanvasContext';
export type { CanvasProviderProps } from './CanvasProvider';
