import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  CloudCog,
  CircleDashed,
  Database,
  Globe,
  Glasses,
  Headphones,
  Monitor,
  Network,
  Plus,
  Server,
  ShieldCheck,
  Smartphone,
  Watch,
  Wifi,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Button, Dialog, DropdownMenu, Tooltip } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { FeishuBrandIcon, TelegramBrandIcon, WeixinBrandIcon } from './RemoteConnectBrandIcons';

export type DeviceNetworkTransport = 'lan' | 'ngrok' | 'sparo_server' | 'custom_server';
export type DeviceNetworkBot = 'telegram' | 'feishu' | 'weixin';

interface DistributedDeviceOverviewProps {
  localDeviceName: string;
  peerDeviceName?: string | null;
  relayConnected: boolean;
  connectedBot?: DeviceNetworkBot | null;
  selectedTransport: DeviceNetworkTransport;
  onSelectTransport: (transport: DeviceNetworkTransport) => void;
  onOpenNetworkSetup: () => void;
  onOpenBotSetup: (bot: DeviceNetworkBot) => void;
}

interface TransportOption {
  id: DeviceNetworkTransport;
  labelKey: string;
  icon: LucideIcon;
}

interface BotOption {
  id: DeviceNetworkBot;
  label: string;
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

const TRANSPORT_OPTIONS: TransportOption[] = [
  { id: 'lan', labelKey: 'tabLan', icon: Wifi },
  { id: 'sparo_server', labelKey: 'tabSparoServer', icon: CloudCog },
  { id: 'ngrok', labelKey: 'tabNgrok', icon: Network },
  { id: 'custom_server', labelKey: 'tabCustomServer', icon: Server },
];

const StatusDot: React.FC<{ active?: boolean }> = ({ active = false }) => (
  <span
    className={`sparo-device-network__status-dot${active ? ' sparo-device-network__status-dot--active' : ''}`}
    aria-hidden="true"
  />
);

export const DistributedDeviceOverview: React.FC<DistributedDeviceOverviewProps> = ({
  localDeviceName,
  peerDeviceName,
  relayConnected,
  connectedBot,
  selectedTransport,
  onSelectTransport,
  onOpenNetworkSetup,
  onOpenBotSetup,
}) => {
  const { t } = useI18n('shell/remote-connect');
  const [transportMenuOpen, setTransportMenuOpen] = useState(false);
  const [unavailableNotice, setUnavailableNotice] = useState<'execution' | 'auxiliary' | null>(null);
  const transportButtonRef = useRef<HTMLButtonElement>(null);
  const visibleLocalDeviceName = localDeviceName || t('thisComputer');
  const selectedTransportOption = TRANSPORT_OPTIONS.find((option) => option.id === selectedTransport)
    ?? TRANSPORT_OPTIONS[0];
  const SelectedTransportIcon = selectedTransportOption.icon;
  const transportMenuItems = useMemo(() => TRANSPORT_OPTIONS.map((option) => ({
    type: 'item' as const,
    id: option.id,
    label: t(option.labelKey),
    checked: option.id === selectedTransport,
    onClick: () => onSelectTransport(option.id),
  })), [onSelectTransport, selectedTransport, t]);

  useEffect(() => {
    if (!transportMenuOpen) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (transportButtonRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.cl-dropdown-menu')) return;
      setTransportMenuOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [transportMenuOpen]);
  const botOptions: BotOption[] = [
    { id: 'weixin', label: t('weixin'), icon: WeixinBrandIcon },
    { id: 'feishu', label: t('feishu'), icon: FeishuBrandIcon },
    { id: 'telegram', label: 'Telegram', icon: TelegramBrandIcon },
  ];

  return (
    <>
    <div className="sparo-device-network">
      <div className="sparo-device-network__columns">
        <section className="sparo-device-network__column sparo-device-network__column--control">
          <h3 className="sparo-device-network__column-title">{t('mobileEndpoint')}</h3>

          <div className="sparo-device-network__control-map">
            <div className="sparo-device-network__phone-cluster">
              <Button
                type="button"
                variant="ghost"
                className={`sparo-device-network__control-device sparo-device-network__control-device--phone${relayConnected ? '' : ' sparo-device-network__control-device--inactive'}`}
                aria-label={t('scanQr')}
                onClick={onOpenNetworkSetup}
              >
                <span className="sparo-device-network__visual-icon">
                  <Smartphone size={54} strokeWidth={1.25} aria-hidden="true" />
                  <StatusDot active={relayConnected} />
                </span>
              </Button>

              <div className={`sparo-device-network__auxiliary-orbit${relayConnected ? '' : ' sparo-device-network__auxiliary-orbit--inactive'}`} aria-label={t('auxiliaryInteraction')}>
                <Tooltip content={t('watch')} placement="bottom">
                  <Button type="button" variant="ghost" className="sparo-device-network__auxiliary-node" aria-label={t('watch')} onClick={() => setUnavailableNotice('auxiliary')}>
                    <Watch size={34} strokeWidth={1.3} aria-hidden="true" />
                  </Button>
                </Tooltip>
                <Tooltip content={t('headphones')} placement="bottom">
                  <Button type="button" variant="ghost" className="sparo-device-network__auxiliary-node" aria-label={t('headphones')} onClick={() => setUnavailableNotice('auxiliary')}>
                    <Headphones size={36} strokeWidth={1.3} aria-hidden="true" />
                  </Button>
                </Tooltip>
                <Tooltip content={t('glasses')} placement="bottom">
                  <Button type="button" variant="ghost" className="sparo-device-network__auxiliary-node" aria-label={t('glasses')} onClick={() => setUnavailableNotice('auxiliary')}>
                    <Glasses size={38} strokeWidth={1.3} aria-hidden="true" />
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>

        </section>

        <section className="sparo-device-network__column sparo-device-network__column--connection">
          <div className="sparo-device-network__connection-stage">
            <div className="sparo-device-network__connection-visual">
              <span className="sparo-device-network__connection-line" />
              <Button
                ref={transportButtonRef}
                type="button"
                variant="ghost"
                className="sparo-device-network__connection-mode"
                aria-label={`${t('transportMethod')}: ${t(selectedTransportOption.labelKey)}`}
                aria-haspopup="menu"
                aria-expanded={transportMenuOpen}
                onClick={() => setTransportMenuOpen((open) => !open)}
              >
                <span className="sparo-device-network__shield" aria-hidden="true">
                  <Globe size={56} strokeWidth={1.05} />
                  <span className="sparo-device-network__transport-icon">
                    <SelectedTransportIcon size={23} strokeWidth={1.45} />
                  </span>
                </span>
                <span className="sparo-device-network__transport-current">
                  {t(selectedTransportOption.labelKey)}
                </span>
              </Button>
              <span className="sparo-device-network__connection-line sparo-device-network__connection-line--right" />
            </div>
            <DropdownMenu
              open={transportMenuOpen}
              anchorRef={transportButtonRef}
              items={transportMenuItems}
              align="left"
              minWidth={176}
              onClose={() => setTransportMenuOpen(false)}
            />
            <div className="sparo-device-network__im-control" role="group" aria-label={t('imControl')}>
              <span className="sparo-device-network__im-summary">
                <strong>{t('imControl')}</strong>
              </span>

              <span className="sparo-device-network__im-channels">
                {botOptions.map((bot) => {
                  const Icon = bot.icon;
                  const selected = bot.id === connectedBot;
                  return (
                    <Tooltip key={bot.id} content={bot.label} placement="top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="small"
                        className="sparo-device-network__im-channel"
                        aria-label={bot.label}
                        aria-pressed={selected}
                        onClick={() => onOpenBotSetup(bot.id)}
                      >
                        <Icon size={18} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  );
                })}
              </span>

              <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </div>
          </div>
        </section>

        <section className="sparo-device-network__column sparo-device-network__column--nodes">
          <h3 className="sparo-device-network__column-title">{t('desktopEndpoint')}</h3>

          <div className="sparo-device-network__node-list">
            <div className="sparo-device-network__node-row" tabIndex={0}>
              <span className="sparo-device-network__node-icon">
                <Monitor size={50} strokeWidth={1.25} aria-hidden="true" />
              </span>
              <span className="sparo-device-network__node-main">
                <strong title={visibleLocalDeviceName}>{visibleLocalDeviceName}</strong>
                <span className="sparo-device-network__node-meta-line">
                  <Badge variant="neutral" className="sparo-device-network__current-device-badge">
                    <StatusDot active />
                    {t('currentDevice')}
                  </Badge>
                  <span className="sparo-device-network__node-role-glyph">
                    <Database size={14} strokeWidth={1.5} aria-hidden="true" />
                    {t('dataCenter')}
                  </span>
                </span>
              </span>
              <div className="sparo-device-network__node-detail">
                <span><Database size={14} aria-hidden="true" />{t('dataCenter')}</span>
                <span><Monitor size={14} aria-hidden="true" />{t('executionNode')}</span>
                <span className="sparo-device-network__node-detail-status"><StatusDot active />{t('localNodeRunning')}</span>
              </div>
            </div>

            {relayConnected && peerDeviceName && (
              <div className="sparo-device-network__node-row" tabIndex={0}>
                <span className="sparo-device-network__node-icon">
                  <Monitor size={50} strokeWidth={1.25} aria-hidden="true" />
                  <StatusDot active />
                </span>
                <span className="sparo-device-network__node-main">
                  <strong>{peerDeviceName}</strong>
                  <Badge variant="neutral">{t('executionNode')}</Badge>
                </span>
              </div>
            )}

            <Button
              type="button"
              variant="ghost"
              size="small"
              className="sparo-device-network__add-node"
              aria-label={t('distributedExecutionTitle')}
              onClick={() => setUnavailableNotice('execution')}
            >
              <Plus size={20} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </div>
        </section>
      </div>

      <footer className="sparo-device-network__footer">
        <span className="sparo-device-network__summary">
          <ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />
          {relayConnected ? t('nodeSummaryConnected') : t('nodeSummary')}
        </span>
      </footer>
    </div>
    <Dialog
      open={unavailableNotice !== null}
      onOpenChange={(open) => {
        if (!open) setUnavailableNotice(null);
      }}
      title={t(unavailableNotice === 'auxiliary' ? 'auxiliaryDevicesTitle' : 'distributedExecutionTitle')}
      size="small"
      contentInset
      showCloseButton
      className="sparo-device-network__notice-dialog"
    >
      <div className="sparo-device-network__execution-notice">
        <div className="sparo-device-network__notice-message">
          <span className="sparo-device-network__notice-icon" aria-hidden="true">
            <CircleDashed size={20} strokeWidth={1.5} />
          </span>
          <p>{t(unavailableNotice === 'auxiliary' ? 'auxiliaryDevicesUnavailable' : 'distributedExecutionUnavailable')}</p>
        </div>
        <Button type="button" variant="secondary" size="small" onClick={() => setUnavailableNotice(null)}>
          {t('gotIt')}
        </Button>
      </div>
    </Dialog>
    </>
  );
};
