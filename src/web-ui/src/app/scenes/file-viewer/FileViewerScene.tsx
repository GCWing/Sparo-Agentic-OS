/**
 * FileViewerScene - workspace files scene.
 *
 * Left pane hosts the workspace file tree. Right pane uses ContentCanvas in
 * project mode so file tabs are managed independently from the agent AuxPane.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { IconButton } from '@/design-system';
import FilesPanel from '../../components/panels/FilesPanel';
import { ContentCanvas } from '../../components/panels/content-canvas';
import { CanvasStoreModeContext } from '../../components/panels/content-canvas/stores';
import './FileViewerScene.scss';

const FILE_NAV_WIDTH_KEY = 'sparo.fileViewer.navWidth';
const FILE_NAV_COLLAPSED_KEY = 'sparo.fileViewer.navCollapsed';
const DEFAULT_FILE_NAV_WIDTH = 260;
const MIN_FILE_NAV_WIDTH = 200;
const MAX_FILE_NAV_WIDTH = 560;
const MIN_CANVAS_PANE_WIDTH = 360;

function loadStoredFileNavWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_FILE_NAV_WIDTH;
  try {
    const raw = localStorage.getItem(FILE_NAV_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_FILE_NAV_WIDTH, Math.max(MIN_FILE_NAV_WIDTH, parsed));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_FILE_NAV_WIDTH;
}

function persistFileNavWidth(width: number): void {
  try {
    localStorage.setItem(FILE_NAV_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

function loadStoredFileNavCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(FILE_NAV_COLLAPSED_KEY) === 'true';
  } catch {
    /* ignore */
  }
  return false;
}

function persistFileNavCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(FILE_NAV_COLLAPSED_KEY, String(collapsed));
  } catch {
    /* ignore */
  }
}

interface FileViewerSceneProps {
  workspacePath?: string;
}

const FileViewerScene: React.FC<FileViewerSceneProps> = ({ workspacePath }) => {
  const { t } = useTranslation('flow-chat');
  const { t: tCommon } = useTranslation('common');
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [navWidth, setNavWidth] = useState(loadStoredFileNavWidth);
  const [isNavCollapsed, setIsNavCollapsed] = useState(loadStoredFileNavCollapsed);
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringResizer, setIsHoveringResizer] = useState(false);

  const calculateValidNavWidth = useCallback((width: number): number => {
    if (!containerRef.current) return width;
    const containerWidth = containerRef.current.offsetWidth;
    const maxAllowed = Math.max(
      MIN_FILE_NAV_WIDTH,
      containerWidth - MIN_CANVAS_PANE_WIDTH - 1
    );
    const cappedMax = Math.min(MAX_FILE_NAV_WIDTH, maxAllowed);
    return Math.min(cappedMax, Math.max(MIN_FILE_NAV_WIDTH, width));
  }, []);

  useEffect(() => {
    const validate = () => {
      setNavWidth((previous) => {
        const next = calculateValidNavWidth(previous);
        return next !== previous ? next : previous;
      });
    };
    const rafId = requestAnimationFrame(validate);
    window.addEventListener('resize', validate);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', validate);
    };
  }, [calculateValidNavWidth]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  const saveAndSetNavWidth = useCallback((width: number) => {
    const next = calculateValidNavWidth(width);
    setNavWidth(next);
    persistFileNavWidth(next);
  }, [calculateValidNavWidth]);

  const handleResizerDoubleClick = useCallback(() => {
    saveAndSetNavWidth(DEFAULT_FILE_NAV_WIDTH);
  }, [saveAndSetNavWidth]);

  const handleResizerMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (!containerRef.current || isNavCollapsed) return;

    const startX = event.clientX;
    const startWidth = navWidth;
    let lastValidWidth = startWidth;

    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(() => {
        lastValidWidth = calculateValidNavWidth(startWidth + moveEvent.clientX - startX);
        setNavWidth(lastValidWidth);
        animationFrameRef.current = null;
      });
    };

    const handleMouseUp = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      persistFileNavWidth(lastValidWidth);
      requestAnimationFrame(() => requestAnimationFrame(() => setIsDragging(false)));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [calculateValidNavWidth, isNavCollapsed, navWidth]);

  const handleToggleNavCollapsed = useCallback(() => {
    setIsNavCollapsed((previous) => {
      const next = !previous;
      persistFileNavCollapsed(next);
      return next;
    });
  }, []);

  const resizerLabel = t('layout.resizer.leftAriaLabel');
  const collapseNavLabel = tCommon('scenes.fileViewerCollapseNav');
  const expandNavLabel = tCommon('scenes.fileViewerExpandNav');

  return (
    <CanvasStoreModeContext.Provider value="project">
      <div
        ref={containerRef}
        className={[
          'sparo-file-viewer-scene',
          isDragging && 'sparo-file-viewer-scene--dragging',
        ].filter(Boolean).join(' ')}
      >
        {isNavCollapsed ? (
          <div className="sparo-file-viewer-scene__rail">
            <IconButton
              className="sparo-file-viewer-scene__rail-action"
              size="small"
              variant="ghost"
              aria-label={expandNavLabel}
              tooltip={expandNavLabel}
              tooltipPlacement="right"
              onClick={handleToggleNavCollapsed}
            >
              <PanelLeftOpen size={15} />
            </IconButton>
          </div>
        ) : (
          <>
            <div
              className="sparo-file-viewer-scene__nav"
              style={{ width: navWidth }}
            >
              <div className="sparo-file-viewer-scene__nav-rail">
                <IconButton
                  className="sparo-file-viewer-scene__rail-action"
                  size="small"
                  variant="ghost"
                  aria-label={collapseNavLabel}
                  tooltip={collapseNavLabel}
                  tooltipPlacement="right"
                  onClick={handleToggleNavCollapsed}
                >
                  <PanelLeftClose size={15} />
                </IconButton>
              </div>
              <div className="sparo-file-viewer-scene__nav-content">
                <FilesPanel workspacePath={workspacePath} />
              </div>
            </div>
            <div
              className={[
                'sparo-pane-resizer',
                isDragging && 'sparo-pane-resizer--dragging',
                isHoveringResizer && 'sparo-pane-resizer--hovering',
              ].filter(Boolean).join(' ')}
              onMouseDown={handleResizerMouseDown}
              onDoubleClick={handleResizerDoubleClick}
              onMouseEnter={() => setIsHoveringResizer(true)}
              onMouseLeave={() => setIsHoveringResizer(false)}
              role="separator"
              aria-orientation="vertical"
              aria-label={resizerLabel}
              aria-valuenow={navWidth}
              aria-valuemin={MIN_FILE_NAV_WIDTH}
              aria-valuemax={MAX_FILE_NAV_WIDTH}
              title={resizerLabel}
            >
              <div className="sparo-pane-resizer__line" />
              <div className="sparo-pane-resizer__handle">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="sparo-pane-resizer__icon" aria-hidden>
                  <circle cx="6" cy="4" r="1" fill="currentColor" />
                  <circle cx="6" cy="8" r="1" fill="currentColor" />
                  <circle cx="6" cy="12" r="1" fill="currentColor" />
                  <circle cx="10" cy="4" r="1" fill="currentColor" />
                  <circle cx="10" cy="8" r="1" fill="currentColor" />
                  <circle cx="10" cy="12" r="1" fill="currentColor" />
                </svg>
              </div>
            </div>
          </>
        )}
        <div className="sparo-file-viewer-scene__content">
          <ContentCanvas workspacePath={workspacePath} mode="project" />
        </div>
      </div>
    </CanvasStoreModeContext.Provider>
  );
};

export default FileViewerScene;
