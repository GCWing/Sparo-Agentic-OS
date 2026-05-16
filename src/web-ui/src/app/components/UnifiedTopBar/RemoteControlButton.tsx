/**
 * RemoteControlButton — top-bar remote control entry point.
 *
 * A compact icon button with a status dot overlay. Clicking opens a popover
 * that shows live connection status and provides all remote control actions
 * (open full dialog, disconnect relay, disconnect bot, cancel pending connection).
 *
 * States:
 *   idle        – no dot; click → open dialog (setup flow)
 *   waiting     – yellow pulsing dot; click → show popover with cancel action
 *   connected   – green dot; click → show popover with disconnect / details actions
 */

import React, {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { MonitorSmartphone } from 'lucide-react';
import { Tooltip } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import {
  remoteConnectAPI,
  type RemoteConnectStatus,
} from '@/infrastructure/api/service-api/RemoteConnectAPI';
import { createLogger } from '@/shared/utils/logger';
import './RemoteControlButton.scss';

const log = createLogger('RemoteControlButton');

// ── Types ─────────────────────────────────────────────────────────────────

type DotState = 'none' | 'waiting' | 'connected';

interface StatusSummary {
  dot: DotState;
  relayConnected: boolean;
  relayWaiting: boolean;
  botConnected: boolean;
  /** Display label for the relay pairing state when waiting. */
  waitingLabel: string;
  /** Human-readable relay method (LAN / BitFun Server / …). */
  relayMethodLabel: string;
  relayUserId: string | null;
  botInfo: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const WAITING_STATES = ['waiting_for_scan', 'verifying', 'handshaking'];

function methodLabel(method: string | null | undefined, tabCustom: string): string {
  if (!method) return '';
  if (method.startsWith('Lan')) return 'LAN';
  if (method.startsWith('Ngrok')) return 'ngrok';
  if (method.startsWith('BitfunServer')) return 'BitFun Server';
  if (method.startsWith('CustomServer')) return tabCustom;
  return method;
}

function deriveStatus(
  s: RemoteConnectStatus | null,
  waitingLabel: string,
  tabCustom: string
): StatusSummary {
  if (!s) {
    return {
      dot: 'none',
      relayConnected: false,
      relayWaiting: false,
      botConnected: false,
      waitingLabel: '',
      relayMethodLabel: '',
      relayUserId: null,
      botInfo: null,
    };
  }

  const relayConnected = s.is_connected;
  const relayWaiting = !relayConnected && WAITING_STATES.includes(s.pairing_state);
  const botConnected = !!s.bot_connected;

  const dot: DotState = relayConnected || botConnected
    ? 'connected'
    : relayWaiting
    ? 'waiting'
    : 'none';

  return {
    dot,
    relayConnected,
    relayWaiting,
    botConnected,
    waitingLabel,
    relayMethodLabel: methodLabel(s.active_method, tabCustom),
    relayUserId: s.peer_user_id ?? null,
    botInfo: s.bot_connected ?? null,
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export interface RemoteControlButtonProps {
  status: RemoteConnectStatus | null;
  /** Opens the full RemoteConnectDialog (handles disclaimer / workspace checks). */
  onOpenDialog: () => void;
  /** Called after a disconnect so the parent can refresh its status state. */
  onStatusChange: (s: RemoteConnectStatus | null) => void;
}

const RemoteControlButton: React.FC<RemoteControlButtonProps> = ({
  status,
  onOpenDialog,
  onStatusChange,
}) => {
  const { t } = useI18n('common');
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const [disconnectingRelay, setDisconnectingRelay] = useState(false);
  const [disconnectingBot, setDisconnectingBot] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const summary = deriveStatus(
    status,
    status?.pairing_state === 'waiting_for_scan'
      ? t('remoteConnect.stateWaiting')
      : status?.pairing_state === 'verifying'
      ? t('remoteConnect.stateVerifying')
      : t('remoteConnect.stateHandshaking'),
    t('remoteConnect.tabCustomServer')
  );

  // ── Popover positioning ─────────────────────────────────────────────────

  const close = useCallback(() => {
    setOpen(false);
    setPopoverPos(null);
  }, []);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPopoverPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPos(null);
      return;
    }
    updatePos();
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', updatePos);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', updatePos);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, updatePos, close]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleOpenDialog = useCallback(() => {
    close();
    onOpenDialog();
  }, [close, onOpenDialog]);

  const handleDisconnectRelay = useCallback(async () => {
    setDisconnectingRelay(true);
    try {
      await remoteConnectAPI.stopConnection();
      const s = await remoteConnectAPI.getStatus();
      onStatusChange(s);
    } catch (e) {
      log.error('stopConnection failed', e);
    } finally {
      setDisconnectingRelay(false);
      close();
    }
  }, [close, onStatusChange]);

  const handleDisconnectBot = useCallback(async () => {
    setDisconnectingBot(true);
    try {
      await remoteConnectAPI.stopBot();
      const s = await remoteConnectAPI.getStatus();
      onStatusChange(s);
    } catch (e) {
      log.error('stopBot failed', e);
    } finally {
      setDisconnectingBot(false);
      close();
    }
  }, [close, onStatusChange]);

  const handleCancelRelay = useCallback(() => {
    void handleDisconnectRelay();
  }, [handleDisconnectRelay]);

  // ── Tooltip label for the button itself ─────────────────────────────────

  const buttonTooltip =
    summary.dot === 'connected'
      ? t('header.remoteControlConnected')
      : summary.dot === 'waiting'
      ? t('header.remoteControlWaiting')
      : t('header.remoteConnect');

  // ── Render ───────────────────────────────────────────────────────────────

  const hasAnyStatus = summary.relayConnected || summary.relayWaiting || summary.botConnected;

  return (
    <>
      <Tooltip content={buttonTooltip} placement="bottom" followCursor disabled={open}>
        <button
          ref={anchorRef}
          type="button"
          className={`rc-btn${open ? ' is-open' : ''}${summary.dot === 'connected' ? ' is-connected' : ''}`}
          aria-label={buttonTooltip}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            if (summary.dot === 'none') {
              onOpenDialog();
            } else {
              setOpen((v) => !v);
            }
          }}
        >
          <MonitorSmartphone size={14} aria-hidden="true" />
          {summary.dot !== 'none' && (
            <span
              className={`rc-btn__dot rc-btn__dot--${summary.dot}`}
              aria-hidden="true"
            />
          )}
        </button>
      </Tooltip>

      {open &&
        popoverPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            {/* Backdrop — captures outside clicks */}
            <div
              className="rc-popover__backdrop"
              aria-hidden="true"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={close}
            />

            {/* Popover */}
            <div
              className="rc-popover"
              role="dialog"
              aria-label={t('header.remoteConnect')}
              style={{ top: popoverPos.top, right: popoverPos.right }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* ─ Header ─ */}
              <div className="rc-popover__header">
                <MonitorSmartphone size={13} aria-hidden="true" />
                <span className="rc-popover__title">{t('header.remoteConnect')}</span>
              </div>

              {/* ─ Body ─ */}
              <div className="rc-popover__body">
                {/* Idle */}
                {!hasAnyStatus && (
                  <div className="rc-popover__row">
                    <span className="rc-popover__dot rc-popover__dot--idle" aria-hidden="true" />
                    <span className="rc-popover__row-label rc-popover__row-label--muted">
                      {t('remoteConnect.stateDisconnected')}
                    </span>
                  </div>
                )}

                {/* Relay: waiting */}
                {summary.relayWaiting && (
                  <div className="rc-popover__section">
                    <div className="rc-popover__row">
                      <span className="rc-popover__dot rc-popover__dot--waiting" aria-hidden="true" />
                      <span className="rc-popover__row-label">{summary.waitingLabel}</span>
                    </div>
                  </div>
                )}

                {/* Relay: connected */}
                {summary.relayConnected && (
                  <div className="rc-popover__section">
                    <div className="rc-popover__row">
                      <span className="rc-popover__dot rc-popover__dot--connected" aria-hidden="true" />
                      <span className="rc-popover__row-label">{t('remoteConnect.stateConnected')}</span>
                    </div>
                    {summary.relayMethodLabel && (
                      <p className="rc-popover__meta">
                        {t('header.remoteControlVia')}: {summary.relayMethodLabel}
                      </p>
                    )}
                    {summary.relayUserId && (
                      <p className="rc-popover__meta">
                        {t('remoteConnect.connectedUserId')}: {summary.relayUserId}
                      </p>
                    )}
                  </div>
                )}

                {/* Bot: connected */}
                {summary.botConnected && (
                  <div className="rc-popover__section">
                    <div className="rc-popover__row">
                      <span className="rc-popover__dot rc-popover__dot--connected" aria-hidden="true" />
                      <span className="rc-popover__row-label">
                        Bot {t('remoteConnect.stateConnected')}
                      </span>
                    </div>
                    {summary.botInfo && (
                      <p className="rc-popover__meta">{summary.botInfo}</p>
                    )}
                  </div>
                )}
              </div>

              {/* ─ Footer (actions) ─ */}
              <div className="rc-popover__footer">
                {/* Always: open full dialog */}
                <button
                  type="button"
                  className="rc-popover__action rc-popover__action--secondary"
                  onClick={handleOpenDialog}
                >
                  {!hasAnyStatus
                    ? t('header.remoteControlSetup')
                    : t('header.remoteControlViewDetails')}
                </button>

                {/* Waiting relay → cancel */}
                {summary.relayWaiting && (
                  <button
                    type="button"
                    className="rc-popover__action rc-popover__action--danger"
                    disabled={disconnectingRelay}
                    onClick={handleCancelRelay}
                  >
                    {disconnectingRelay
                      ? t('header.remoteControlDisconnecting')
                      : t('remoteConnect.cancel')}
                  </button>
                )}

                {/* Relay connected → disconnect */}
                {summary.relayConnected && (
                  <button
                    type="button"
                    className="rc-popover__action rc-popover__action--danger"
                    disabled={disconnectingRelay}
                    onClick={() => void handleDisconnectRelay()}
                  >
                    {disconnectingRelay
                      ? t('header.remoteControlDisconnecting')
                      : t('remoteConnect.disconnect')}
                  </button>
                )}

                {/* Bot connected → disconnect bot */}
                {summary.botConnected && (
                  <button
                    type="button"
                    className="rc-popover__action rc-popover__action--danger"
                    disabled={disconnectingBot}
                    onClick={() => void handleDisconnectBot()}
                  >
                    {disconnectingBot
                      ? t('header.remoteControlDisconnecting')
                      : t('header.remoteControlDisconnectBot')}
                  </button>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
};

export default RemoteControlButton;
