/**
 * Remote Connect dialog with two independent groups:
 *   - Connection carrier (LAN / Ngrok / Sparo relay / self-hosted) - mutually exclusive
 *   - IM control (Telegram / Feishu / WeChat) - mutually exclusive
 * Both groups can be active simultaneously.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CloudCog, Network, QrCode, Server, Wifi } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useI18n } from '@/infrastructure/i18n';
import { AppWindow, Dialog, Badge, Button, Input, SegmentedControl } from '@/design-system';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import {
  remoteConnectAPI,
  type ConnectionResult,
  type RemoteConnectStatus,
} from '@/infrastructure/api/service-api/RemoteConnectAPI';
import {
  RemoteConnectDisclaimerContent,
} from './RemoteConnectDisclaimer';
import {
  getRemoteConnectDisclaimerAgreed,
  setRemoteConnectDisclaimerAgreed,
} from './remoteConnectDisclaimerStorage';
import {
  DistributedDeviceOverview,
  type DeviceNetworkBot,
  type DeviceNetworkTransport,
} from './DistributedDeviceOverview';
import { FeishuBrandIcon, TelegramBrandIcon, WeixinBrandIcon } from './RemoteConnectBrandIcons';
import './RemoteConnectDialog.scss';

// Types

type ActiveGroup = 'network' | 'bot';
type NetworkTab = 'lan' | 'ngrok' | 'sparo_server' | 'custom_server';
type BotTab = 'telegram' | 'feishu' | 'weixin';

/**
 * iLink `qrcode_img_content` is the string to encode in a QR (the legacy reference client passes it to
 * `qrcode-terminal.generate`), not necessarily an `<img src>` raster URL. Only treat
 * as raster when it is clearly a data-URL or direct image link.
 */
function isWeixinRasterQrSrc(raw: string): boolean {
  const t = raw.trim();
  if (/^data:image\//i.test(t)) return true;
  if (
    /^https?:\/\//i.test(t)
    && /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(t)
  ) {
    return true;
  }
  return false;
}

const NETWORK_TABS: { id: NetworkTab; labelKey: string }[] = [
  { id: 'lan', labelKey: 'remoteConnect.tabLan' },
  { id: 'ngrok', labelKey: 'remoteConnect.tabNgrok' },
  { id: 'sparo_server', labelKey: 'remoteConnect.tabSparoServer' },
  { id: 'custom_server', labelKey: 'remoteConnect.tabCustomServer' },
];

const BOT_TABS: { id: BotTab; label: string }[] = [
  { id: 'telegram', label: 'Telegram' },
  { id: 'feishu', label: '' }, // filled from i18n
  { id: 'weixin', label: '' },
];

const NGROK_SETUP_URL = 'https://dashboard.ngrok.com/get-started/setup';
const RELAY_SERVER_README_URL = 'https://github.com/GCWing/Sparo-Agentic-OS/blob/main/src/apps/relay-server/README.md';
const FEISHU_SETUP_GUIDE_URLS = {
  'zh-CN': 'https://github.com/GCWing/Sparo-Agentic-OS/blob/main/docs/remote-connect/feishu-bot-setup.zh-CN.md',
  'en-US': 'https://github.com/GCWing/Sparo-Agentic-OS/blob/main/docs/remote-connect/feishu-bot-setup.md',
} as const;

const methodToNetworkTab = (method: string | null | undefined): NetworkTab | null => {
  if (!method) return null;
  if (method.startsWith('Lan')) return 'lan';
  if (method.startsWith('Ngrok')) return 'ngrok';
  if (method.startsWith('SparoServer')) return 'sparo_server';
  if (method.startsWith('CustomServer')) return 'custom_server';
  return null;
};

const botInfoToBotTab = (info: string | null | undefined): BotTab | null => {
  if (!info) return null;
  if (info.startsWith('Telegram')) return 'telegram';
  if (info.startsWith('Feishu')) return 'feishu';
  if (info.startsWith('Weixin')) return 'weixin';
  return null;
};

// Component

interface RemoteConnectDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RemoteConnectDialog: React.FC<RemoteConnectDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t: tRemote, currentLanguage } = useI18n('shell/remote-connect');

  const [showSetup, setShowSetup] = useState(false);
  const [autoStartNetwork, setAutoStartNetwork] = useState(false);
  const [autoStartWeixin, setAutoStartWeixin] = useState(false);
  const [activeGroup, setActiveGroup] = useState<ActiveGroup>('network');
  const [networkTab, setNetworkTab] = useState<NetworkTab>(NETWORK_TABS[0].id);
  const [botTab, setBotTab] = useState<BotTab>(BOT_TABS[0].id);

  const [connectionResult, setConnectionResult] = useState<ConnectionResult | null>(null);
  const [status, setStatus] = useState<RemoteConnectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lanNetworkInfo, setLanNetworkInfo] = useState<{ localIp: string; gatewayIp: string | null } | null>(null);
  const [lanNetworkInfoLoading, setLanNetworkInfoLoading] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [hasAgreedDisclaimer, setHasAgreedDisclaimer] = useState<boolean>(() => getRemoteConnectDisclaimerAgreed());
  const [botVerboseMode, setBotVerboseMode] = useState<boolean>(false);
  const [localDeviceName, setLocalDeviceName] = useState('');

  const [qrCopied, setQrCopied] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [tgToken, setTgToken] = useState('');
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [weixinIlinkToken, setWeixinIlinkToken] = useState('');
  const [weixinBaseUrl, setWeixinBaseUrl] = useState('');
  const [weixinBotAccountId, setWeixinBotAccountId] = useState('');
  const [weixinQrSessionKey, setWeixinQrSessionKey] = useState<string | null>(null);
  const [weixinQrImageUrl, setWeixinQrImageUrl] = useState<string | null>(null);
  const [weixinAwaitingPhoneConfirm, setWeixinAwaitingPhoneConfirm] = useState(false);

  const formSnapshotRef = useRef({
    customUrl: '',
    tgToken: '',
    feishuAppId: '',
    feishuAppSecret: '',
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTargetRef = useRef<'relay' | 'bot'>('relay');
  const statusRef = useRef<RemoteConnectStatus | null>(null);
  /** True after the first `getStatus` pass finishes while `status` was still null (including failed attempts). */
  const [statusFetchFinished, setStatusFetchFinished] = useState(false);

  statusRef.current = status;

  // Derived state

  const isRelayConnected = status?.pairing_state === 'connected';
  const isBotConnected = !!status?.bot_connected;
  const connectedNetworkTab = methodToNetworkTab(status?.active_method);
  const connectedBotTab = botInfoToBotTab(status?.bot_connected);

  // Polling

  const startPolling = useCallback((target: 'relay' | 'bot') => {
    pollTargetRef.current = target;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await remoteConnectAPI.getStatus();
        setStatus(s);
        const done = target === 'relay'
          ? s.pairing_state === 'connected'
          : !!s.bot_connected;
        if (done) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch { /* ignore */ }
    }, 2000);
  }, []);

  // On dialog open: check if a connection (restored bot / ongoing relay) is active.
  useEffect(() => {
    if (!isOpen) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setStatusFetchFinished(false);
      setShowSetup(false);
      setAutoStartNetwork(false);
      setAutoStartWeixin(false);
      return;
    }

    setHasAgreedDisclaimer(getRemoteConnectDisclaimerAgreed());

    let cancelled = false;
    const checkExisting = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const s = await remoteConnectAPI.getStatus();
          if (cancelled) return;
          setStatus(s);
          setBotVerboseMode(s.bot_verbose_mode);

          if (s.bot_connected) {
            const tab = botInfoToBotTab(s.bot_connected);
            setActiveGroup('bot');
            if (tab) setBotTab(tab);
            return;
          }
          if (s.pairing_state === 'connected') {
            const tab = methodToNetworkTab(s.active_method);
            setActiveGroup('network');
            if (tab) setNetworkTab(tab);
            return;
          }
          if (['waiting_for_scan', 'verifying', 'handshaking'].includes(s.pairing_state)) {
            startPolling('relay');
            return;
          }
        } catch { /* ignore */ }
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1500));
          if (cancelled) return;
        }
      }
    };

    const hadCachedStatus = statusRef.current !== null;
    if (hadCachedStatus) {
      void checkExisting();
    } else {
      void (async () => {
        try {
          await checkExisting();
        } finally {
          if (!cancelled) {
            setStatusFetchFinished(true);
          }
        }
      })();
    }

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isOpen, startPolling]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void remoteConnectAPI.getDeviceInfo()
      .then((device) => {
        if (!cancelled) setLocalDeviceName(device.device_name);
      })
      .catch(() => {
        // The overview has a translated local-device fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeGroup !== 'network' || networkTab !== 'lan') {
      setLanNetworkInfoLoading(false);
      return;
    }
    let cancelled = false;
    const loadLanNetworkInfo = async () => {
      setLanNetworkInfoLoading(true);
      try {
        const info = await remoteConnectAPI.getLanNetworkInfo();
        if (!cancelled) {
          setLanNetworkInfo(
            info
              ? { localIp: info.local_ip, gatewayIp: info.gateway_ip ?? null }
              : null,
          );
        }
      } finally {
        if (!cancelled) {
          setLanNetworkInfoLoading(false);
        }
      }
    };
    void loadLanNetworkInfo();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeGroup, networkTab]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadFormState = async () => {
      try {
        const formState = await remoteConnectAPI.getFormState();
        if (cancelled) return;
        setCustomUrl(formState.custom_server_url ?? '');
        setTgToken(formState.telegram_bot_token ?? '');
        setFeishuAppId(formState.feishu_app_id ?? '');
        setFeishuAppSecret(formState.feishu_app_secret ?? '');
        setWeixinIlinkToken(formState.weixin_ilink_token ?? '');
        setWeixinBaseUrl(formState.weixin_base_url ?? '');
        setWeixinBotAccountId(formState.weixin_bot_account_id ?? '');
      } catch {
        // Ignore form-state restore failures and keep in-memory defaults.
      }
    };
    void loadFormState();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    formSnapshotRef.current = {
      customUrl,
      tgToken,
      feishuAppId,
      feishuAppSecret,
    };
  }, [customUrl, tgToken, feishuAppId, feishuAppSecret]);

  const prepareAndStartWeixinBotFromQr = useCallback(async (
    ilinkToken: string,
    baseUrl: string,
    botAccountId: string,
  ): Promise<ConnectionResult> => {
    const fs = formSnapshotRef.current;
    await remoteConnectAPI.setFormState({
      custom_server_url: fs.customUrl,
      telegram_bot_token: fs.tgToken,
      feishu_app_id: fs.feishuAppId,
      feishu_app_secret: fs.feishuAppSecret,
      weixin_ilink_token: ilinkToken,
      weixin_base_url: baseUrl || undefined,
      weixin_bot_account_id: botAccountId,
    });
    await remoteConnectAPI.configureBot({
      botType: 'weixin',
      weixinIlinkToken: ilinkToken,
      weixinBaseUrl: baseUrl || undefined,
      weixinBotAccountId: botAccountId,
    });
    return await remoteConnectAPI.startConnection('bot_weixin');
  }, []);

  // WeChat QR login: poll iLink until confirmed or error (session key cleared on completion).
  useEffect(() => {
    const key = weixinQrSessionKey;
    if (!key) return;
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        try {
          const p = await remoteConnectAPI.weixinQrPoll(key);
          if (cancelled) return;
          if (p.status === 'scanned') {
            setWeixinQrImageUrl(null);
            setWeixinAwaitingPhoneConfirm(true);
            continue;
          }
          if (p.status === 'confirmed' && p.ilink_token && p.bot_account_id) {
            const token = p.ilink_token;
            const base = p.base_url ?? '';
            const bid = p.bot_account_id;
            setWeixinAwaitingPhoneConfirm(false);
            setWeixinIlinkToken(token);
            setWeixinBaseUrl(base);
            setWeixinBotAccountId(bid);
            // Hide QR immediately, but keep `weixinQrSessionKey` until the pipeline finishes.
            // Clearing the session key first re-runs this effect's cleanup and sets `cancelled`,
            // so after `await` we would skip `setConnectionResult` and never `setLoading(false)`.
            setWeixinQrImageUrl(null);
            setConnectionResult(null);
            setError(null);
            setLoading(true);
            try {
              const result = await prepareAndStartWeixinBotFromQr(token, base, bid);
              if (!cancelled) {
                setConnectionResult(result);
                startPolling('bot');
              }
            } catch (e: unknown) {
              if (!cancelled) {
                setError(e instanceof Error ? e.message : String(e));
              }
            } finally {
              if (!cancelled) {
                setLoading(false);
              }
            }
            if (!cancelled) {
              setWeixinQrSessionKey(null);
            }
            return;
          }
          if (p.status === 'error') {
            setError(p.message);
            setWeixinQrSessionKey(null);
            setWeixinQrImageUrl(null);
            setWeixinAwaitingPhoneConfirm(false);
            return;
          }
          if (p.status === 'expired' && p.qr_image_url) {
            setWeixinQrImageUrl(p.qr_image_url);
            setWeixinAwaitingPhoneConfirm(false);
          }
        } catch (e: unknown) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
          }
          setWeixinQrSessionKey(null);
          setWeixinQrImageUrl(null);
          setWeixinAwaitingPhoneConfirm(false);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weixinQrSessionKey, prepareAndStartWeixinBotFromQr, startPolling]);

  // Connection handlers

  const handleConnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    setConnectionResult(null);

    try {
      await remoteConnectAPI.setFormState({
        custom_server_url: customUrl,
        telegram_bot_token: tgToken,
        feishu_app_id: feishuAppId,
        feishu_app_secret: feishuAppSecret,
        weixin_ilink_token: weixinIlinkToken,
        weixin_base_url: weixinBaseUrl,
        weixin_bot_account_id: weixinBotAccountId,
      });

      let method: string;
      let serverUrl: string | undefined;

      if (activeGroup === 'bot') {
        if (botTab === 'telegram') {
          method = 'bot_telegram';
        } else if (botTab === 'feishu') {
          method = 'bot_feishu';
        } else {
          method = 'bot_weixin';
        }
        if (botTab === 'telegram' && tgToken) {
          await remoteConnectAPI.configureBot({ botType: 'telegram', botToken: tgToken });
        } else if (botTab === 'feishu' && feishuAppId) {
          await remoteConnectAPI.configureBot({
            botType: 'feishu', appId: feishuAppId, appSecret: feishuAppSecret,
          });
        } else if (botTab === 'weixin' && weixinIlinkToken && weixinBotAccountId) {
          await remoteConnectAPI.configureBot({
            botType: 'weixin',
            weixinIlinkToken: weixinIlinkToken,
            weixinBaseUrl: weixinBaseUrl || undefined,
            weixinBotAccountId: weixinBotAccountId,
          });
        }
      } else {
        method = networkTab;
        if (networkTab === 'custom_server') serverUrl = customUrl || undefined;
      }
      const result = await remoteConnectAPI.startConnection(method, serverUrl);
      setConnectionResult(result);
      startPolling(activeGroup === 'bot' ? 'bot' : 'relay');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [activeGroup, networkTab, botTab, customUrl, tgToken, feishuAppId, feishuAppSecret, weixinIlinkToken, weixinBaseUrl, weixinBotAccountId, startPolling]);

  const handleStartWeixinQr = useCallback(async () => {
    setError(null);
    setWeixinAwaitingPhoneConfirm(false);
    setLoading(true);
    try {
      const r = await remoteConnectAPI.weixinQrStart(null);
      setWeixinQrSessionKey(r.session_key);
      setWeixinQrImageUrl(r.qr_image_url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCancelWeixinQr = useCallback(() => {
    setWeixinQrSessionKey(null);
    setWeixinQrImageUrl(null);
    setWeixinAwaitingPhoneConfirm(false);
  }, []);

  const handleDisconnectRelay = useCallback(async () => {
    try {
      await remoteConnectAPI.stopConnection();
      setConnectionResult(null);
      const s = await remoteConnectAPI.getStatus();
      setStatus(s);
    } catch { /* best effort */ }
  }, []);

  const handleDisconnectBot = useCallback(async () => {
    try {
      await remoteConnectAPI.stopBot();
      setConnectionResult(null);
      const s = await remoteConnectAPI.getStatus();
      setStatus(s);
    } catch { /* best effort */ }
  }, []);

  const handleToggleBotVerboseMode = async () => {
    const newMode = !botVerboseMode;
    setBotVerboseMode(newMode);
    await remoteConnectAPI.setBotVerboseMode(newMode);
  };

  const handleCancelConnect = useCallback(async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    try {
      if (activeGroup === 'bot') {
        await remoteConnectAPI.stopBot();
      } else {
        await remoteConnectAPI.stopConnection();
      }
    } catch { /* best effort */ }
    setConnectionResult(null);
    const s = await remoteConnectAPI.getStatus();
    setStatus(s);
  }, [activeGroup]);

  const handleCloseSetup = useCallback(() => {
    setShowSetup(false);
    setAutoStartNetwork(false);
    setAutoStartWeixin(false);

    if (activeGroup === 'bot') {
      if (!isBotConnected) {
        handleCancelWeixinQr();
        void handleCancelConnect();
      }
      return;
    }

    if (!isRelayConnected) {
      void handleCancelConnect();
    }
  }, [activeGroup, handleCancelConnect, handleCancelWeixinQr, isBotConnected, isRelayConnected]);

  const handleOpenNgrokSetup = useCallback(() => {
    void systemAPI.openExternal(NGROK_SETUP_URL);
  }, []);

  const handleOpenRelayReadme = useCallback(() => {
    void systemAPI.openExternal(RELAY_SERVER_README_URL);
  }, []);

  const handleOpenFeishuGuide = useCallback(() => {
    void systemAPI.openExternal(FEISHU_SETUP_GUIDE_URLS[currentLanguage]);
  }, [currentLanguage]);

  const openNetworkSetup = useCallback((transport?: NetworkTab) => {
    setActiveGroup('network');
    if (transport) setNetworkTab(transport);
    setConnectionResult(null);
    setError(null);
    setAutoStartNetwork(true);
    setShowSetup(true);
  }, []);

  const openBotSetup = useCallback((tab: BotTab) => {
    setActiveGroup('bot');
    setBotTab(tab);
    setConnectionResult(null);
    setError(null);
    setAutoStartWeixin(tab === 'weixin');
    setShowSetup(true);
  }, []);

  useEffect(() => {
    if (!showSetup || !autoStartNetwork || activeGroup !== 'network') return;
    setAutoStartNetwork(false);
    if (networkTab === 'custom_server' && !customUrl.trim()) return;
    if (isRelayConnected && connectedNetworkTab === networkTab) return;
    void handleConnect();
  }, [activeGroup, autoStartNetwork, connectedNetworkTab, customUrl, handleConnect, isRelayConnected, networkTab, showSetup]);

  useEffect(() => {
    if (!showSetup || !autoStartWeixin || activeGroup !== 'bot' || botTab !== 'weixin') return;
    setAutoStartWeixin(false);
    if (weixinQrSessionKey || weixinQrImageUrl || (weixinIlinkToken && weixinBotAccountId)) return;
    void handleStartWeixinQr();
  }, [activeGroup, autoStartWeixin, botTab, handleStartWeixinQr, showSetup, weixinBotAccountId, weixinIlinkToken, weixinQrImageUrl, weixinQrSessionKey]);

  const renderInfoCard = (children: React.ReactNode) => (
    <div className="sparo-remote-connect__info-card">
      {children}
    </div>
  );

  const renderSetupContext = () => {
    const networkContexts = {
      lan: { Icon: Wifi, summaryKey: 'setupSummaryLan' },
      ngrok: { Icon: Network, summaryKey: 'setupSummaryNgrok' },
      sparo_server: { Icon: CloudCog, summaryKey: 'setupSummarySparoServer' },
      custom_server: { Icon: Server, summaryKey: 'setupSummaryCustomServer' },
    } as const;
    const botContexts = {
      telegram: { Icon: TelegramBrandIcon, summaryKey: 'setupSummaryTelegram' },
      feishu: { Icon: FeishuBrandIcon, summaryKey: 'setupSummaryFeishu' },
      weixin: { Icon: WeixinBrandIcon, summaryKey: 'setupSummaryWeixin' },
    } as const;
    const context = activeGroup === 'network' ? networkContexts[networkTab] : botContexts[botTab];
    const Icon = context.Icon;

    return (
      <div className="sparo-remote-connect__setup-context">
        <span className="sparo-remote-connect__setup-context-icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <p>{tRemote(context.summaryKey)}</p>
      </div>
    );
  };

  const renderLanNetworkDetails = () => (
    <div className="sparo-remote-connect__setup-details">
      {lanNetworkInfoLoading ? (
        <div className="sparo-remote-connect__info-meta-group sparo-remote-connect__info-meta-group--skeleton" aria-hidden="true">
          <div className="sparo-remote-connect__info-meta-skeleton-line sparo-remote-connect__info-meta-skeleton-line--long" />
          <div className="sparo-remote-connect__info-meta-skeleton-line sparo-remote-connect__info-meta-skeleton-line--medium" />
        </div>
      ) : (
        <>
          <span><strong>{tRemote('currentIp')}</strong>{lanNetworkInfo?.localIp || '—'}</span>
          <span><strong>{tRemote('gatewayIp')}</strong>{lanNetworkInfo?.gatewayIp || '—'}</span>
        </>
      )}
    </div>
  );

  // Renderers

  const renderErrorBlock = () => {
    if (!error) return null;
    const isNgrokErr = error.includes('ngrok is not installed');
    return (
      <div className="sparo-remote-connect__error-group">
        <p className="sparo-remote-connect__error">{error}</p>
        {isNgrokErr && (
          <Button
            type="button"
            variant="ghost"
            size="small"
            className="sparo-remote-connect__error-action"
            onClick={handleOpenNgrokSetup}
          >
            {tRemote('openNgrokSetup')}
          </Button>
        )}
      </div>
    );
  };

  const renderConnectedView = (
    onDisconnect: () => void,
    userId?: string | null,
  ) => (
    <div className="sparo-remote-connect__connected">
      <div className="sparo-remote-connect__status">
        <Badge variant="success">{tRemote('stateConnected')}</Badge>
        {userId && (
          <span className="sparo-remote-connect__peer-user-id">
            {tRemote('connectedUserId')}: {userId}
          </span>
        )}
      </div>
      <p className="sparo-remote-connect__hint">{tRemote('connectedHint')}</p>
      <Button
        type="button"
        variant="secondary"
        size="small"
        className="sparo-remote-connect__action"
        onClick={onDisconnect}
      >
        {tRemote('disconnect')}
      </Button>
    </div>
  );

  const renderPairingInProgress = () => {
    if (!connectionResult) return null;
    return (
      <div className="sparo-remote-connect__body">
        {(connectionResult.qr_url || (activeGroup === 'network' && networkTab === 'lan')) && (
          <div className="sparo-remote-connect__pairing-main">
            {connectionResult.qr_url && (
              <div
                className="sparo-remote-connect__qr-box"
                style={{ cursor: 'pointer' }}
                title="Click to copy URL"
                onClick={() => {
                  navigator.clipboard.writeText(connectionResult.qr_url!);
                  setQrCopied(true);
                  setTimeout(() => setQrCopied(false), 2000);
                }}
              >
                <QRCodeSVG value={connectionResult.qr_url} size={180} level="M" includeMargin />
              </div>
            )}
            {activeGroup === 'network' && networkTab === 'lan' && renderLanNetworkDetails()}
          </div>
        )}
        {connectionResult.bot_pairing_code && (
          <div className="sparo-remote-connect__pairing-code-box">
            <div className="sparo-remote-connect__pairing-code">
              {connectionResult.bot_pairing_code}
            </div>
          </div>
        )}
        <div className="sparo-remote-connect__status">
          <Badge variant={qrCopied ? 'success' : 'warning'}>
            {qrCopied
              ? tRemote('urlCopied')
              : activeGroup === 'bot'
                ? tRemote('stateWaitingBot')
                : tRemote('stateWaiting')}
          </Badge>
        </div>
        <p className="sparo-remote-connect__hint">
          {activeGroup === 'bot' ? tRemote('botHint') : tRemote('scanHint')}
        </p>
      </div>
    );
  };

  // Network group content

  const NGROK_USAGE_URL = 'https://dashboard.ngrok.com/legacy/usage';

  const renderNetworkContent = () => {
    if (isRelayConnected && connectedNetworkTab === networkTab) {
      return (
        <>
          {networkTab === 'ngrok' && (
            <p className="sparo-remote-connect__ngrok-usage-link">
              <span
                className="sparo-remote-connect__description-link"
                role="link"
                tabIndex={0}
                onClick={() => systemAPI.openExternal(NGROK_USAGE_URL)}
                onKeyDown={(e) => { if (e.key === 'Enter') systemAPI.openExternal(NGROK_USAGE_URL); }}
              >
                {tRemote('ngrokUsageLink')}
              </span>
            </p>
          )}
          {renderConnectedView(
            handleDisconnectRelay,
            status?.peer_user_id,
          )}
        </>
      );
    }
    if (connectionResult && activeGroup === 'network') {
      return renderPairingInProgress();
    }
    if ((loading || autoStartNetwork) && networkTab !== 'custom_server') {
      return (
        <div className="sparo-remote-connect__body">
          <div className="sparo-remote-connect__pairing-main">
            <div className="sparo-remote-connect__qr-box sparo-remote-connect__qr-box--loading" aria-busy="true">
              <QrCode size={34} strokeWidth={1.25} aria-hidden="true" />
            </div>
            {networkTab === 'lan' && renderLanNetworkDetails()}
          </div>
          <Badge variant="neutral">{tRemote('connecting')}</Badge>
        </div>
      );
    }
    return (
      <div className="sparo-remote-connect__body">
        {networkTab === 'lan' && (
          renderLanNetworkDetails()
        )}
        {networkTab === 'ngrok' && (
          <Button type="button" variant="ghost" size="small" className="sparo-remote-connect__inline-link" onClick={handleOpenNgrokSetup}>
            {tRemote('openNgrokSetup')}
          </Button>
        )}
        {networkTab === 'custom_server' && (
          <div className="sparo-remote-connect__setup-fields">
            <Input
              className="sparo-remote-connect__field sparo-remote-connect__field--inline"
              type="url"
              placeholder="https://relay.example.com:9700"
              prefix={<span className="sparo-remote-connect__field-prefix">{tRemote('serverUrl')}</span>}
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
            />
            <Button type="button" variant="ghost" size="small" className="sparo-remote-connect__inline-link" onClick={handleOpenRelayReadme}>
              {tRemote('desc_custom_server_link')}
            </Button>
          </div>
        )}
        {renderErrorBlock()}
        <Button
          type="button"
          variant="primary"
          size="small"
          className="sparo-remote-connect__action sparo-remote-connect__action--primary"
          onClick={handleConnect}
          disabled={loading || (networkTab === 'custom_server' && !customUrl.trim())}
          isLoading={loading}
          loadingLabel={tRemote('connecting')}
        >
          {tRemote('connect')}
        </Button>
      </div>
    );
  };

  // Bot group content

  const renderBotContent = () => {
    if (isBotConnected && connectedBotTab === botTab) {
      return (
        <div className="sparo-remote-connect__connected">
          <div className="sparo-remote-connect__status">
            <Badge variant="success">{tRemote('stateConnected')}</Badge>
          </div>
          <SegmentedControl
            className="sparo-remote-connect__mode-selector"
            size="small"
            value={botVerboseMode ? 'verbose' : 'concise'}
            ariaLabel={tRemote('botVerboseMode')}
            options={[
              { value: 'concise', label: tRemote('botConciseMode') },
              { value: 'verbose', label: tRemote('botVerboseMode') },
            ]}
            onChange={(value) => {
              if ((value === 'verbose') !== botVerboseMode) {
                void handleToggleBotVerboseMode();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="small"
            className="sparo-remote-connect__action"
            onClick={handleDisconnectBot}
          >
            {tRemote('disconnect')}
          </Button>
        </div>
      );
    }
    if (connectionResult && activeGroup === 'bot') {
      return renderPairingInProgress();
    }
    return (
      <div className="sparo-remote-connect__body">
        {botTab === 'telegram' ? (
          <div className="sparo-remote-connect__bot-guide">
            {renderInfoCard(
              <div className="sparo-remote-connect__steps">
                <p className="sparo-remote-connect__step">1. {tRemote('botTgStep1')}</p>
                <p className="sparo-remote-connect__step">2. {tRemote('botTgStep2')}</p>
                <p className="sparo-remote-connect__step">3. {tRemote('botTgStep3')}</p>
              </div>,
            )}
            <Input
              className="sparo-remote-connect__field sparo-remote-connect__field--inline"
              type="text"
              placeholder="123456:xxxxxxxxxxxxxxxxxxxxxxxx"
              prefix={<span className="sparo-remote-connect__field-prefix">Bot Token</span>}
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
            />
          </div>
        ) : botTab === 'feishu' ? (
          <div className="sparo-remote-connect__bot-guide">
            {renderInfoCard(
              <>
                <p className="sparo-remote-connect__info-text">
                  {tRemote('botFeishuDocPrefix')}
                  <span
                    className="sparo-remote-connect__description-link"
                    role="link"
                    tabIndex={0}
                    onClick={handleOpenFeishuGuide}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleOpenFeishuGuide(); }}
                  >
                    {tRemote('botFeishuDocLink')}
                  </span>
                  {tRemote('botFeishuDocSuffix')}
                </p>
                <div className="sparo-remote-connect__steps">
                  <p className="sparo-remote-connect__step">
                    1. {tRemote('botFeishuStep1Prefix')}
                    <span
                      className="sparo-remote-connect__step-link"
                      role="link"
                      tabIndex={0}
                      onClick={() => systemAPI.openExternal('https://open.feishu.cn/app')}
                      onKeyDown={(e) => { if (e.key === 'Enter') systemAPI.openExternal('https://open.feishu.cn/app'); }}
                    >
                      {tRemote('botFeishuOpenPlatform')}
                    </span>
                    {tRemote('botFeishuStep1Suffix')}
                  </p>
                  <p className="sparo-remote-connect__step">2. {tRemote('botFeishuStep2')}</p>
                  <p className="sparo-remote-connect__step">3. {tRemote('botFeishuStep3')}</p>
                </div>
              </>,
            )}
            <Input
              className="sparo-remote-connect__field sparo-remote-connect__field--inline"
              type="text"
              placeholder="cli_xxxxxxxx"
              prefix={<span className="sparo-remote-connect__field-prefix">App ID</span>}
              value={feishuAppId}
              onChange={(e) => setFeishuAppId(e.target.value)}
            />
            <Input
              className="sparo-remote-connect__field sparo-remote-connect__field--inline"
              type="password"
              placeholder="xxxxxxxxxxxxxxxx"
              prefix={<span className="sparo-remote-connect__field-prefix">App Secret</span>}
              value={feishuAppSecret}
              onChange={(e) => setFeishuAppSecret(e.target.value)}
            />
          </div>
        ) : (
          <div className="sparo-remote-connect__bot-guide sparo-remote-connect__bot-guide--weixin">
            <div className="sparo-remote-connect__pairing-main sparo-remote-connect__pairing-main--weixin">
              <div className="sparo-remote-connect__weixin-qr">
                {weixinQrImageUrl ? (
                  isWeixinRasterQrSrc(weixinQrImageUrl) ? (
                    <img src={weixinQrImageUrl} alt="WeChat QR" className="sparo-remote-connect__weixin-qr-img" />
                  ) : (
                    <div className="sparo-remote-connect__weixin-qr-svg-wrap" role="img" aria-label="WeChat login QR">
                      <QRCodeSVG value={weixinQrImageUrl} size={180} level="M" includeMargin />
                    </div>
                  )
                ) : (
                  <div className={`sparo-remote-connect__qr-box sparo-remote-connect__qr-box--placeholder${loading || autoStartWeixin ? ' sparo-remote-connect__qr-box--loading' : ''}`}>
                    <QrCode size={34} strokeWidth={1.25} aria-hidden="true" />
                  </div>
                )}
              </div>
              {renderInfoCard(
                <div className="sparo-remote-connect__steps">
                  <p className="sparo-remote-connect__step">1. {tRemote('botWeixinStep1')}</p>
                  <p className="sparo-remote-connect__step">2. {tRemote('botWeixinStep2')}</p>
                </div>,
              )}
            </div>
            {weixinQrImageUrl && <p className="sparo-remote-connect__hint">{tRemote('botWeixinPolling')}</p>}
            {weixinQrSessionKey && !weixinQrImageUrl && weixinAwaitingPhoneConfirm && (
              <p className="sparo-remote-connect__hint">{tRemote('botWeixinAwaitingPhoneConfirm')}</p>
            )}
            {!weixinQrSessionKey && !weixinQrImageUrl && !loading && !autoStartWeixin && !weixinIlinkToken ? (
              <Button type="button" variant="secondary" size="small" className="sparo-remote-connect__action" onClick={handleStartWeixinQr}>
                {tRemote('botWeixinQrButton')}
              </Button>
            ) : null}
            {weixinIlinkToken && weixinBotAccountId && !weixinQrSessionKey && (
              <p className="sparo-remote-connect__hint">{tRemote('botWeixinLinked')}</p>
            )}
          </div>
        )}
        {renderErrorBlock()}
        {(botTab !== 'weixin' || (weixinIlinkToken && weixinBotAccountId && !weixinQrSessionKey && !weixinQrImageUrl)) && (
          <Button
            type="button"
            variant="primary"
            size="small"
            className="sparo-remote-connect__action sparo-remote-connect__action--primary"
            onClick={handleConnect}
            disabled={loading || (botTab === 'telegram' ? !tgToken : !feishuAppId)}
            isLoading={loading}
            loadingLabel={tRemote('connecting')}
          >
            {tRemote('connect')}
          </Button>
        )}
      </div>
    );
  };

  // Layout

  /** First open in session: no cached `status` yet -show skeleton until `getStatus` completes. */
  const showRemoteConnectSkeleton = isOpen && status === null && !statusFetchFinished;
  const handleAgreeDisclaimer = useCallback(() => {
    setRemoteConnectDisclaimerAgreed();
    setHasAgreedDisclaimer(true);
    setShowDisclaimer(false);
  }, []);

  const renderSetupView = () => (
    <div className="sparo-remote-connect">
      {showRemoteConnectSkeleton ? (
        <div
          className="sparo-remote-connect__skeleton"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="sparo-remote-connect__body sparo-remote-connect__skeleton-body">
            <div className="sparo-remote-connect__skeleton-card" />
            <div className="sparo-remote-connect__skeleton-line sparo-remote-connect__skeleton-line--short" />
            <div className="sparo-remote-connect__skeleton-line" />
            <div className="sparo-remote-connect__skeleton-line sparo-remote-connect__skeleton-line--medium" />
          </div>
        </div>
      ) : (
        <>
          {renderSetupContext()}
          {activeGroup === 'network' ? renderNetworkContent() : renderBotContent()}
        </>
      )}
    </div>
  );

  const setupDialogTitle = activeGroup === 'network'
    ? `${tRemote(NETWORK_TABS.find((tab) => tab.id === networkTab)?.labelKey.replace('remoteConnect.', '') ?? 'groupNetwork')} · ${tRemote('setupTitle')}`
    : `${botTab === 'feishu' ? tRemote('feishu') : botTab === 'weixin' ? tRemote('weixin') : 'Telegram'} · ${tRemote('setupTitle')}`;

  return (
    <>
      <AppWindow
        open={isOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onClose();
          }
        }}
        title={tRemote('networkTitle')}
        titleExtra={(
          <span className="sparo-remote-connect__title-extra">
            <Button
              type="button"
              variant="ghost"
              size="small"
              className="sparo-remote-connect__header-action"
              aria-label={tRemote('scanQr')}
              onClick={() => openNetworkSetup()}
            >
              <QrCode size={16} strokeWidth={1.6} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="small"
              className="sparo-remote-connect__disclaimer-trigger"
              onClick={() => setShowDisclaimer(true)}
            >
              {tRemote('disclaimerReview')}
            </Button>
          </span>
        )}
        showCloseButton
        size="wide"
        className="sparo-remote-connect-window"
        contentClassName="sparo-remote-connect-modal__content"
      >
        <DistributedDeviceOverview
          localDeviceName={localDeviceName}
          peerDeviceName={status?.peer_device_name}
          relayConnected={isRelayConnected}
          connectedBot={connectedBotTab as DeviceNetworkBot | null}
          selectedTransport={networkTab as DeviceNetworkTransport}
          onSelectTransport={(transport) => setNetworkTab(transport as NetworkTab)}
          onOpenNetworkSetup={() => openNetworkSetup()}
          onOpenBotSetup={(tab) => openBotSetup(tab as BotTab)}
        />
      </AppWindow>

      <Dialog
        open={isOpen && showSetup}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            handleCloseSetup();
          }
        }}
        title={setupDialogTitle}
        showCloseButton
        size="medium"
        className="sparo-remote-connect__setup-dialog"
        overlayClassName="sparo-remote-connect-setup-overlay"
        contentClassName="sparo-remote-connect-modal__content"
      >
        {renderSetupView()}
      </Dialog>

      <Dialog
        open={showDisclaimer}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setShowDisclaimer(false);
          }
        }}
        title={tRemote('disclaimerTitle')}
        showCloseButton
        size="large"
        contentInset
      >
        <RemoteConnectDisclaimerContent
          agreed={hasAgreedDisclaimer}
          onClose={() => setShowDisclaimer(false)}
          onAgree={hasAgreedDisclaimer ? undefined : handleAgreeDisclaimer}
        />
      </Dialog>
    </>
  );
};

export default RemoteConnectDialog;
