/**
 * UnifiedTopBar — full-width application top bar.
 *
 * Layout (left → right):
 *   [macOS traffic-lights reserve] [Logo▼ menu: toolbar, appearance, language, about]
 *   [context capsule: ← | title] (conditional) ─drag─
 *   [search trigger] ─drag─ [📱 Remote] [_][□][×]
 *
 * Unified back button / title logic:
 *   - overlay active          → back closes overlay + overlay scene title
 *   - non-Dispatcher session  → back opens Agentic OS (Dispatcher) + session mode / workspace
 *   - Dispatcher session      → no back button, no title (logo-only chrome)
 *   - no session              → nothing extra shown
 *
 * The empty areas between interactive elements act as Tauri window-drag regions.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  FolderOpen,
  ListChecks,
  Search,
} from 'lucide-react';
import { Modal, Tooltip, WindowControls, DropdownMenu } from '@/component-library';
import type { DropdownMenuEntry } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import type { LocaleId } from '@/infrastructure/i18n/types';
import { useToolbarModeContext } from '@/flow_chat/components/toolbar-mode/ToolbarModeContext';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useNotification } from '@/shared/notification-system';
import { RemoteConnectDialog } from '../RemoteConnectDialog';
import {
  RemoteConnectDisclaimerContent,
} from '../RemoteConnectDialog/RemoteConnectDisclaimer';
import {
  getRemoteConnectDisclaimerAgreed,
  setRemoteConnectDisclaimerAgreed,
} from '../RemoteConnectDialog/remoteConnectDisclaimerStorage';
import { useOverlayStore } from '../../stores/overlayStore';
import { useHeaderStore } from '../../stores/headerStore';
import { useSessionCapsuleStore } from '../../stores/sessionCapsuleStore';
import { useSessionProfile } from '../../session-profiles';
import { getOverlayDef } from '../../overlay/overlayRegistry';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { ALL_SHORTCUTS } from '@/shared/constants/shortcuts';
import { createLogger } from '@/shared/utils/logger';
import { openDispatcherSession } from '@/flow_chat/services/openDispatcherSession';
import {
  remoteConnectAPI,
  type RemoteConnectStatus,
} from '@/infrastructure/api/service-api/RemoteConnectAPI';
import RemoteControlButton from './RemoteControlButton';
import NotificationDropdownButton from './NotificationDropdownButton';
import GlobalSearchDialog from '../GlobalSearchDialog/GlobalSearchDialog';
import type { OverlaySceneId } from '../../overlay/types';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { SYSTEM_THEME_ID } from '@/infrastructure/theme/types';
import './UnifiedTopBar.scss';

const log = createLogger('UnifiedTopBar');

const NAV_TOGGLE_SEARCH_DEF = ALL_SHORTCUTS.find((d) => d.id === 'nav.toggleSearch')!;

const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, a, [role="button"], [contenteditable="true"], .window-controls, [role="menu"]';

export interface UnifiedTopBarProps {
  activeOverlay: OverlaySceneId | null;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
}

const UnifiedTopBar: React.FC<UnifiedTopBarProps> = ({
  activeOverlay,
  onMinimize,
  onMaximize,
  onClose,
  isMaximized = false,
}) => {
  const {
    t: tCommon,
    currentLanguage,
    supportedLocales,
    changeLanguage,
    isChanging: localeChanging,
  } = useI18n('common');
  const { t: tHeader } = useI18n('shell/header');
  const { t: tNav } = useI18n('shell/navigation');
  const { t: tRemote } = useI18n('shell/remote-connect');
  const { themes, themeId, setTheme, loading: themeLoading } = useTheme();
  const { enableToolbarMode } = useToolbarModeContext();
  const { hasWorkspace } = useLastUsedWorkspace();
  const { warning } = useNotification();
  const closeOverlay = useOverlayStore((s) => s.closeOverlay);
  const sessionContext = useHeaderStore((s) => s.sessionContext);
  const requestExpandSessionList = useSessionCapsuleStore((s) => s.requestExpandSessionList);
  const { profile } = useSessionProfile();
  const hasWindowControls = !!(onMinimize && onMaximize && onClose);
  const hasOverlay = activeOverlay !== null;

  const [searchOpen, setSearchOpen] = useState(false);
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const [showRemoteConnect, setShowRemoteConnect] = useState(false);
  const [showRemoteDisclaimer, setShowRemoteDisclaimer] = useState(false);
  const [hasAgreedRemoteDisclaimer, setHasAgreedRemoteDisclaimer] = useState<boolean>(() =>
    getRemoteConnectDisclaimerAgreed()
  );
  const [remoteConnectStatus, setRemoteConnectStatus] = useState<RemoteConnectStatus | null>(null);

  const logoMenuAnchorRef = useRef<HTMLDivElement>(null);
  const lastMouseDownTimeRef = useRef<number>(0);

  // ── Logo menu item handlers ───────────────────────────────────────────────

  const handleThemePick = useCallback(
    (id: string) => { void setTheme(id); },
    [setTheme],
  );

  const handleLocalePick = useCallback(
    (locale: LocaleId) => {
      if (localeChanging) return;
      void changeLanguage(locale);
    },
    [changeLanguage, localeChanging],
  );

  const handleLogoAbout = useCallback(() => {
    setLogoMenuOpen(false);
    window.dispatchEvent(new CustomEvent('nav:show-about'));
  }, []);

  const handleFloatingMode = useCallback(() => {
    setLogoMenuOpen(false);
    enableToolbarMode();
  }, [enableToolbarMode]);

  const handleRemoteConnect = useCallback(async () => {
    if (!hasWorkspace) {
      warning(tHeader('remoteConnectRequiresWorkspace'));
      return;
    }
    setLogoMenuOpen(false);
    if (hasAgreedRemoteDisclaimer || getRemoteConnectDisclaimerAgreed()) {
      setHasAgreedRemoteDisclaimer(true);
      setShowRemoteConnect(true);
      return;
    }
    setShowRemoteDisclaimer(true);
  }, [hasWorkspace, warning, tHeader, hasAgreedRemoteDisclaimer]);

  const handleAgreeDisclaimer = useCallback(() => {
    setRemoteConnectDisclaimerAgreed();
    setHasAgreedRemoteDisclaimer(true);
    setShowRemoteDisclaimer(false);
    setShowRemoteConnect(true);
  }, []);

  // ── Remote connect polling ────────────────────────────────────────────────

  const isTauriDesktop = useMemo(
    () => typeof window !== 'undefined' && '__TAURI__' in window,
    [],
  );

  const isMacOS = useMemo(() => {
    return (
      isTauriDesktop &&
      typeof navigator !== 'undefined' &&
      typeof navigator.platform === 'string' &&
      navigator.platform.toUpperCase().includes('MAC')
    );
  }, [isTauriDesktop]);

  useEffect(() => {
    if (!isTauriDesktop) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await remoteConnectAPI.getStatus();
        if (!cancelled) setRemoteConnectStatus(s);
      } catch {
        if (!cancelled) setRemoteConnectStatus(null);
      }
    };
    void poll();
    const id = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isTauriDesktop]);

  // ── Global search shortcut ────────────────────────────────────────────────

  const toggleNavSearch = useCallback(() => { setSearchOpen((v) => !v); }, []);

  useShortcut(NAV_TOGGLE_SEARCH_DEF.id, NAV_TOGGLE_SEARCH_DEF.config, toggleNavSearch, {
    priority: 5,
    description: NAV_TOGGLE_SEARCH_DEF.descriptionKey,
  });

  // ── Context nav ───────────────────────────────────────────────────────────

  const overlayDef = hasOverlay ? getOverlayDef(activeOverlay) : null;
  const overlayTitle = overlayDef?.labelKey ? tCommon(overlayDef.labelKey) : (overlayDef?.label ?? '');

  const sessionWorkspaceName = useMemo(() => {
    const explicit = sessionContext?.workspaceDisplayName?.trim();
    if (explicit) return explicit;
    const p = sessionContext?.workspacePath;
    if (!p) return '';
    return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
  }, [sessionContext?.workspacePath, sessionContext?.workspaceDisplayName]);

  const sessionTitle = useMemo(() => {
    if (!sessionContext) return '';
    if (!profile.topBar.showContextNav) return '';
    const label = sessionContext.mode ?? '';
    return sessionWorkspaceName ? `${label} / ${sessionWorkspaceName}` : label;
  }, [sessionContext, profile.topBar.showContextNav, sessionWorkspaceName]);

  const showContextNav = hasOverlay || (!!sessionContext && profile.topBar.showContextNav);
  const contextTitle = hasOverlay ? overlayTitle : sessionTitle;
  const backTooltip = tCommon('overlay.returnToAgenticOS');

  const handleContextBack = useCallback(() => {
    if (hasOverlay) { closeOverlay(); return; }
    void openDispatcherSession();
  }, [hasOverlay, closeOverlay]);

  // ── Window drag ───────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const now = Date.now();
    const timeSinceLastMouseDown = now - lastMouseDownTimeRef.current;
    lastMouseDownTimeRef.current = now;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest(INTERACTIVE_SELECTOR)) return;
    if (timeSinceLastMouseDown < 500 && timeSinceLastMouseDown > 50) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      } catch (error) {
        log.debug('startDragging failed', error);
      }
    })();
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      onMaximize?.();
    },
    [onMaximize],
  );

  // ── Logo menu items ───────────────────────────────────────────────────────

  const logoMenuItems = useMemo((): DropdownMenuEntry[] => {
    const appearanceSubmenu: DropdownMenuEntry[] = [
      {
        type: 'item',
        id: 'theme-system',
        label: tHeader('followSystemTheme'),
        checked: themeId === SYSTEM_THEME_ID,
        onClick: () => handleThemePick(SYSTEM_THEME_ID),
        disabled: themeLoading,
      },
      ...themes.map((th) => ({
        type: 'item' as const,
        id: `theme-${th.id}`,
        label: th.name,
        checked: themeId !== SYSTEM_THEME_ID && themeId === th.id,
        onClick: () => handleThemePick(th.id),
        disabled: themeLoading,
      })),
    ];

    const languageSubmenu: DropdownMenuEntry[] = supportedLocales.map((loc) => ({
      type: 'item' as const,
      id: `locale-${loc.id}`,
      label: loc.nativeName,
      checked: currentLanguage === loc.id,
      onClick: () => handleLocalePick(loc.id as LocaleId),
      disabled: localeChanging,
    }));

    return [
      {
        type: 'item',
        id: 'toolbar-mode',
        label: tHeader('switchToToolbar'),
        onClick: handleFloatingMode,
      },
      {
        type: 'item',
        id: 'appearance',
        label: tHeader('appearance'),
        submenu: appearanceSubmenu,
      },
      {
        type: 'item',
        id: 'language',
        label: tHeader('language'),
        submenu: languageSubmenu,
      },
      { type: 'separator', id: 'sep' },
      {
        type: 'item',
        id: 'about',
        label: tHeader('about'),
        onClick: handleLogoAbout,
      },
    ];
  }, [
    currentLanguage,
    handleFloatingMode,
    handleLocalePick,
    handleLogoAbout,
    handleThemePick,
    localeChanging,
    supportedLocales,
    tHeader,
    themeId,
    themeLoading,
    themes,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  const rootCls = [
    'unified-top-bar',
    isMacOS && 'unified-top-bar--macos',
    hasWindowControls && 'unified-top-bar--has-controls',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div
        className={rootCls}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        role="toolbar"
        aria-label={tNav('aria.sceneHeader')}
      >
        {/* Left: app logo menu + overlay navigation */}
        <div className="unified-top-bar__left">
          <div className="unified-top-bar__logo-wrap" ref={logoMenuAnchorRef}>
            <Tooltip content={tHeader('openMenu')} placement="bottom" followCursor disabled={logoMenuOpen}>
              <button
                type="button"
                className={`unified-top-bar__logo-btn${logoMenuOpen ? ' is-open' : ''}`}
                aria-label={tHeader('openMenu')}
                aria-haspopup="menu"
                aria-expanded={logoMenuOpen}
                onClick={() => setLogoMenuOpen((v) => !v)}
              >
                <span className="unified-top-bar__logo-mark" aria-hidden="true">
                  <img
                    className="unified-top-bar__logo-img"
                    src="/sparo-logo-mark.png"
                    alt=""
                    draggable={false}
                  />
                </span>
              </button>
            </Tooltip>

            <DropdownMenu
              open={logoMenuOpen}
              anchorRef={logoMenuAnchorRef}
              items={logoMenuItems}
              onClose={() => setLogoMenuOpen(false)}
              align="left"
              minWidth={160}
            />
          </div>

          {hasOverlay && (
            <Tooltip content={tNav('sessionCapsule.openTaskList')} placement="bottom" followCursor>
              <button
                type="button"
                className="unified-top-bar__task-list-btn"
                onClick={requestExpandSessionList}
                aria-label={tNav('sessionCapsule.openTaskList')}
                data-testid="unified-top-bar-task-list"
                data-bitfun-ignore-session-capsule-outside
              >
                <ListChecks size={14} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </Tooltip>
          )}

          {showContextNav && (
            <div className="unified-top-bar__context-nav">
              <div className="unified-top-bar__context-capsule">
                <Tooltip content={backTooltip} placement="bottom" followCursor>
                  <button
                    type="button"
                    className="unified-top-bar__context-capsule-back"
                    onClick={handleContextBack}
                    aria-label={backTooltip}
                    data-testid="unified-top-bar-back"
                  >
                    <ArrowLeft size={14} strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </Tooltip>
                {contextTitle ? (
                  <>
                    <span className="unified-top-bar__context-capsule-split" aria-hidden="true" />
                    <div className="unified-top-bar__context-capsule-title">
                      <div className="unified-top-bar__context-title">
                        {!hasOverlay && sessionWorkspaceName && profile.topBar.showWorkspaceName && (
                          <span className="unified-top-bar__context-mode">
                            {sessionContext?.mode}
                          </span>
                        )}
                        {!hasOverlay && sessionWorkspaceName && profile.topBar.showWorkspaceName && (
                          <span className="unified-top-bar__context-sep" aria-hidden="true">/</span>
                        )}
                        {!hasOverlay && sessionWorkspaceName && profile.topBar.showWorkspaceName ? (
                          <span className="unified-top-bar__context-workspace">
                            <FolderOpen size={11} aria-hidden="true" />
                            <span>{sessionWorkspaceName}</span>
                          </span>
                        ) : (
                          <span className="unified-top-bar__context-label">{contextTitle}</span>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Center: global search */}
        <div className="unified-top-bar__search">
          <Tooltip
            content={tNav('search.headerSearchHint')}
            placement="bottom"
            followCursor
          >
            <button
              type="button"
              className="unified-top-bar__search-trigger"
              onClick={() => setSearchOpen(true)}
              aria-label={tNav('search.headerSearchHint')}
            >
              <span className="unified-top-bar__search-row">
                <span className="unified-top-bar__search-icon" aria-hidden="true">
                  <Search size={12} />
                </span>
                <span className="unified-top-bar__search-label">
                  {tNav('search.headerSearchHint')}
                </span>
              </span>
            </button>
          </Tooltip>
          <GlobalSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
        </div>

        {/* Right: remote control + notification + window controls */}
        <div className="unified-top-bar__right">
          {isTauriDesktop && (
            <RemoteControlButton
              status={remoteConnectStatus}
              onOpenDialog={() => void handleRemoteConnect()}
              onStatusChange={setRemoteConnectStatus}
            />
          )}
          <NotificationDropdownButton />
          {hasWindowControls && !isMacOS && (
            <div className="unified-top-bar__controls">
              <WindowControls
                onMinimize={onMinimize!}
                onMaximize={onMaximize!}
                onClose={onClose!}
                isMaximized={isMaximized}
              />
            </div>
          )}
        </div>
      </div>

      <RemoteConnectDialog isOpen={showRemoteConnect} onClose={() => setShowRemoteConnect(false)} />
      <Modal
        isOpen={showRemoteDisclaimer}
        onClose={() => setShowRemoteDisclaimer(false)}
        title={tRemote('disclaimerTitle')}
        showCloseButton
        size="large"
        contentInset
      >
        <RemoteConnectDisclaimerContent
          agreed={hasAgreedRemoteDisclaimer}
          onClose={() => setShowRemoteDisclaimer(false)}
          onAgree={handleAgreeDisclaimer}
        />
      </Modal>
    </>
  );
};

export default UnifiedTopBar;
