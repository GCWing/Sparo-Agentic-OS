/**
 * FloatingFileTree �?floating rounded-rect file tree panel.
 *
 * ⚠️  CURRENTLY DISABLED �?this component is not rendered anywhere.
 * To enable: uncomment in WorkspaceBody.tsx and import this component.
 *
 * Design intent:
 *   - position: fixed, covering the full window layer
 *   - Appears as a rounded rectangle (not a sidebar) floating over content
 *   - Draggable by its header to reposition freely
 *   - Toggle visibility via keyboard shortcut or toolbar button
 *   - Contains the workspace file tree browser
 *
 * Pending prerequisites before enabling:
 *   1. Decide drag-handle UX (title-bar drag vs full-panel drag)
 *   2. Wire up file tree data source
 *   3. Define keyboard shortcut in shortcuts.ts
 *   4. Add toggle button in UnifiedTopBar or WorkDock
 *
 * ────────────────────────────────────────────────────────────────
 * EVERYTHING BELOW IS COMMENTED OUT INTENTIONALLY.
 * Uncomment when ready to activate.
 * ────────────────────────────────────────────────────────────────
 */

/*
import React, { useCallback, useRef, useState } from 'react';
import { FolderTree, X, GripVertical } from 'lucide-react';
import { IconButton } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { createLogger } from '@/shared/utils/logger';
import './FloatingFileTree.scss';

const log = createLogger('FloatingFileTree');
const STORAGE_KEY_POS  = 'sparo.floatingFileTree.position';
const STORAGE_KEY_OPEN = 'sparo.floatingFileTree.open';

interface Position { x: number; y: number }

function readPosition(): Position {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) return JSON.parse(raw) as Position;
  } catch {}
  return { x: 16, y: 80 };
}

function savePosition(pos: Position): void {
  try { localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(pos)); } catch {}
}

function readOpen(): boolean {
  try { return localStorage.getItem(STORAGE_KEY_OPEN) === 'true'; } catch { return false; }
}

function saveOpen(v: boolean): void {
  try { localStorage.setItem(STORAGE_KEY_OPEN, String(v)); } catch {}
}

const FloatingFileTree: React.FC = () => {
  const { t } = useI18n('common');
  const [open, setOpen] = useState(readOpen);
  const [pos, setPos]   = useState<Position>(readPosition);
  const draggingRef     = useRef(false);
  const startRef        = useRef<{ mx: number; my: number; px: number; py: number }>({ mx: 0, my: 0, px: 0, py: 0 });

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    startRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    e.preventDefault();

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = {
        x: startRef.current.px + (ev.clientX - startRef.current.mx),
        y: startRef.current.py + (ev.clientY - startRef.current.my),
      };
      setPos(next);
    };

    const onUp = () => {
      draggingRef.current = false;
      savePosition(pos); // save last confirmed position
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  const close = useCallback(() => {
    setOpen(false);
    saveOpen(false);
  }, []);

  if (!open) return null;

  return (
    <div
      className="floating-file-tree"
      style={{ left: pos.x, top: pos.y }}
    >
      // Drag handle / header
      <div
        className="floating-file-tree__header"
        onMouseDown={handleDragStart}
        role="toolbar"
      >
        <GripVertical size={13} className="floating-file-tree__grip" aria-hidden="true" />
        <FolderTree size={13} aria-hidden="true" />
        <span className="floating-file-tree__title">
          {t('scenes.fileViewer')}
        </span>
        <IconButton
            className="floating-file-tree__close-control"
            onClick={close}
            aria-label={t('common.close')}
            tooltip={t('common.close')}
            tooltipPlacement="bottom"
            size="xs"
            variant="ghost"
          >
            <X size={12} />
        </IconButton>
      </div>

      // File tree body �?wire up file tree component here
      <div className="floating-file-tree__body">
        <div className="floating-file-tree__placeholder">
          {/* File tree will be rendered here *\/}
        </div>
      </div>
    </div>
  );
};

export default FloatingFileTree;
*/

// Placeholder export so imports in comments don't cause module-not-found errors
// if someone attempts to reference the file before it's enabled.
export {};
