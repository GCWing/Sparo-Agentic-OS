/**
 * ShellScene �?self-contained shell page with internal left-right layout.
 *
 * ShellNav was previously injected via nav-registry; it is now
 * embedded here beside TerminalScene, matching SettingsScene’s pattern.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────�?
 *   �?ShellNav (resizable) �?divider �?TerminalScene      �?
 *   �?session list         �?        �?ConnectedTerminal  �?
 *   └────────────────────────────────────────────────────�?
 */

import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import ShellNav from './ShellNav';
import './ShellScene.scss';

const TerminalScene = lazy(() => import('../terminal/TerminalScene'));

const SHELL_NAV_WIDTH_KEY = 'sparo.shellNavWidth';
const DEFAULT_SHELL_NAV_WIDTH = 220;
const MIN_SHELL_NAV_WIDTH = 160;
const MAX_SHELL_NAV_WIDTH = 560;
const MIN_TERMINAL_PANE_WIDTH = 200;

function loadStoredShellNavWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_SHELL_NAV_WIDTH;
  try {
    const raw = localStorage.getItem(SHELL_NAV_WIDTH_KEY);
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(MAX_SHELL_NAV_WIDTH, Math.max(MIN_SHELL_NAV_WIDTH, n));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SHELL_NAV_WIDTH;
}

function persistShellNavWidth(width: number): void {
  try {
    localStorage.setItem(SHELL_NAV_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

interface ShellSceneProps {
  workspacePath?: string;
  isActive?: boolean;
}

const ShellScene: React.FC<ShellSceneProps> = ({ workspacePath, isActive = true }) => {
  const { t } = useTranslation('flow-chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [navWidth, setNavWidth] = useState(loadStoredShellNavWidth);
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringResizer, setIsHoveringResizer] = useState(false);

  const calculateValidNavWidth = useCallback((w: number): number => {
    if (!containerRef.current) return w;
    const cw = containerRef.current.offsetWidth;
    const maxAllowed = Math.max(
      MIN_SHELL_NAV_WIDTH,
      cw - MIN_TERMINAL_PANE_WIDTH - 1,
    );
    const cap = Math.min(MAX_SHELL_NAV_WIDTH, maxAllowed);
    return Math.min(cap, Math.max(MIN_SHELL_NAV_WIDTH, w));
  }, []);

  useEffect(() => {
    const validate = () => {
      setNavWidth((prev) => {
        const next = calculateValidNavWidth(prev);
        return next !== prev ? next : prev;
      });
    };
    const raf = requestAnimationFrame(validate);
    window.addEventListener('resize', validate);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', validate);
    };
  }, [calculateValidNavWidth]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const saveAndSetNavWidth = useCallback((w: number) => {
    const v = calculateValidNavWidth(w);
    setNavWidth(v);
    persistShellNavWidth(v);
  }, [calculateValidNavWidth]);

  const handleResizerDoubleClick = useCallback(() => {
    saveAndSetNavWidth(DEFAULT_SHELL_NAV_WIDTH);
  }, [saveAndSetNavWidth]);

  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const startX = e.clientX;
    const startWidth = navWidth;
    let lastValid = startWidth;

    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(() => {
        const delta = ev.clientX - startX;
        lastValid = calculateValidNavWidth(startWidth + delta);
        setNavWidth(lastValid);
        animationFrameRef.current = null;
      });
    };

    const onUp = () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      persistShellNavWidth(lastValid);
      requestAnimationFrame(() => requestAnimationFrame(() => setIsDragging(false)));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [navWidth, calculateValidNavWidth]);

  const resizerLabel = t('layout.resizer.leftAriaLabel');
  const resizerTitle = t('layout.resizer.leftAriaLabel');

  return (
    <div
      ref={containerRef}
      className={[
        'sparo-shell-scene',
        isDragging && 'sparo-shell-scene--dragging',
      ].filter(Boolean).join(' ')}
    >
      <div
        className="sparo-shell-scene__nav"
        style={{ width: navWidth }}
      >
        <ShellNav workspacePath={workspacePath} />
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
        aria-valuemin={MIN_SHELL_NAV_WIDTH}
        aria-valuemax={MAX_SHELL_NAV_WIDTH}
        title={resizerTitle}
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
      <div className="sparo-shell-scene__content">
        <Suspense fallback={<div className="sparo-shell-scene__loading" />}>
          <TerminalScene isActive={isActive} />
        </Suspense>
      </div>
    </div>
  );
};

export default ShellScene;
