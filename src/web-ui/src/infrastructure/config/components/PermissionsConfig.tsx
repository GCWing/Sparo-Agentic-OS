import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Dialog,
  NumberField,
  Switch,
} from '@/design-system';
import { ConfigPageHeader, ConfigPageLayout, ConfigPageContent, ConfigPageSection, ConfigPageRow, ConfigPageLoading } from './common';
import { IS_TAURI_DESKTOP, useSessionSettingsConfig } from './useSessionSettingsConfig';
import './AIFeaturesConfig.scss';
import './DebugConfig.scss';

const PermissionsConfig: React.FC = () => {
  const { t } = useTranslation('settings/permissions');
  const {
    isLoading,
    skipToolConfirmation,
    confirmationTimeout,
    executionTimeout,
    goalMaxContinuationTurns,
    toolExecConfigLoading,
    computerUseEnabled,
    computerUseAccess,
    computerUseScreen,
    computerUseBusy,
    browserCdpAvailable,
    browserKind,
    browserVersion,
    browserPageCount,
    browserControlBusy,
    browserRestartPrompt,
    platform,
    handleSkipToolConfirmationChange,
    handleComputerUseEnabledChange,
    handleComputerUseOpenSettings,
    handleBrowserControlLaunch,
    handleBrowserControlRestart,
    handleBrowserControlCreateLauncher,
    setBrowserRestartPrompt,
    handleToolTimeoutChange,
    handleGoalMaxContinuationTurnsChange,
    tTools,
  } = useSessionSettingsConfig();

  if (isLoading) {
    return (
      <ConfigPageLayout className="sparo-func-agent-config">
        <ConfigPageHeader title={t('title')} description={t('subtitle')} />
        <ConfigPageContent className="sparo-func-agent-config__content">
          <ConfigPageLoading text={t('loading.text')} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  return (
    <ConfigPageLayout className="sparo-func-agent-config">
      <ConfigPageHeader title={t('title')} description={t('subtitle')} />
      <ConfigPageContent className="sparo-func-agent-config__content">
        <ConfigPageSection
          title={t('toolExecution.sectionTitle')}
        >
          <ConfigPageRow
            label={tTools('config.autoExecute')}
            description={tTools('config.autoExecuteDesc')}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control">
              <Switch
                checked={skipToolConfirmation}
                onChange={(e) => handleSkipToolConfirmationChange(e.target.checked)}
                disabled={toolExecConfigLoading}
                size="small"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            label={tTools('config.confirmTimeout')}
            description={tTools('config.confirmTimeoutDesc')}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control">
              <NumberField
                value={confirmationTimeout === '' ? 0 : parseInt(confirmationTimeout, 10)}
                onChange={(val) => handleToolTimeoutChange('confirmation', val === 0 ? '' : String(val))}
                min={0}
                max={3600}
                step={5}
                unit={tTools('config.seconds')}
                size="small"
                variant="compact"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            label={tTools('config.executionTimeout')}
            description={tTools('config.executionTimeoutDesc')}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control">
              <NumberField
                value={executionTimeout === '' ? 0 : parseInt(executionTimeout, 10)}
                onChange={(val) => handleToolTimeoutChange('execution', val === 0 ? '' : String(val))}
                min={0}
                max={3600}
                step={5}
                unit={tTools('config.seconds')}
                size="small"
                variant="compact"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            label={t('goalMode.maxContinuationTurns')}
            description={t('goalMode.maxContinuationTurnsDesc')}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control">
              <NumberField
                value={goalMaxContinuationTurns}
                onChange={handleGoalMaxContinuationTurnsChange}
                min={1}
                max={1000}
                step={5}
                unit={t('goalMode.turns')}
                size="small"
                variant="compact"
                disabled={toolExecConfigLoading}
              />
            </div>
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('computerUse.sectionTitle')}
        >
          {IS_TAURI_DESKTOP ? (
            <>
              <ConfigPageRow label={t('computerUse.enable')} description={t('computerUse.enableDesc')} align="center">
                <div className="sparo-func-agent-config__row-control">
                  <Switch
                    checked={computerUseEnabled}
                    onChange={(e) => handleComputerUseEnabledChange(e.target.checked)}
                    disabled={computerUseBusy}
                    size="small"
                  />
                </div>
              </ConfigPageRow>
              <ConfigPageRow
                label={t('computerUse.accessibility')}
                description={t('computerUse.accessibilityDesc')}
                align="center"
                balanced
              >
                <div
                  className="sparo-func-agent-config__row-control"
                  style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}
                >
                  <span className={computerUseAccess ? 'sparo-func-agent-config__perm-status--granted' : undefined}>
                    {computerUseAccess ? t('computerUse.granted') : t('computerUse.notGranted')}
                  </span>
                  <Button
                    className="sparo-func-agent-config__row-action-btn"
                    size="small"
                    variant="secondary"
                    disabled={computerUseBusy}
                    onClick={() => void handleComputerUseOpenSettings('accessibility')}
                  >
                    {t('computerUse.openSettings')}
                  </Button>
                </div>
              </ConfigPageRow>
              <ConfigPageRow
                label={t('computerUse.screenCapture')}
                description={t('computerUse.screenCaptureDesc')}
                align="center"
                balanced
              >
                <div
                  className="sparo-func-agent-config__row-control"
                  style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}
                >
                  <span className={computerUseScreen ? 'sparo-func-agent-config__perm-status--granted' : undefined}>
                    {computerUseScreen ? t('computerUse.granted') : t('computerUse.notGranted')}
                  </span>
                  <Button
                    className="sparo-func-agent-config__row-action-btn"
                    size="small"
                    variant="secondary"
                    disabled={computerUseBusy}
                    onClick={() => void handleComputerUseOpenSettings('screen_capture')}
                  >
                    {t('computerUse.openSettings')}
                  </Button>
                </div>
              </ConfigPageRow>
            </>
          ) : null}
        </ConfigPageSection>

        <ConfigPageSection
          title={t('browserControl.sectionTitle')}
        >
          {IS_TAURI_DESKTOP ? (
            <>
              <ConfigPageRow
                label={t('browserControl.status')}
                description={t('browserControl.statusDesc') || undefined}
                align="center"
                balanced
              >
                <div
                  className="sparo-func-agent-config__row-control"
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span title={browserCdpAvailable && browserVersion ? `${browserKind} ${browserVersion}` : undefined}>
                    <Badge variant={browserCdpAvailable ? 'success' : 'neutral'}>
                      {browserCdpAvailable ? t('browserControl.connected') : t('browserControl.notConnected')}
                    </Badge>
                  </span>
                  {browserCdpAvailable ? (
                    <span className="sparo-func-agent-config__hint">
                      {browserKind} / {browserPageCount} {t('browserControl.tabs')}
                    </span>
                  ) : null}
                  {!browserCdpAvailable && (
                    <Button
                      className="sparo-func-agent-config__row-action-btn"
                      size="small"
                      variant="secondary"
                      disabled={browserControlBusy}
                      onClick={() => void handleBrowserControlLaunch()}
                    >
                      {t('browserControl.connect')}
                    </Button>
                  )}
                </div>
              </ConfigPageRow>
              {platform === 'macos' && (
                <ConfigPageRow
                  label={t('browserControl.createLauncher')}
                  description={t('browserControl.createLauncherDesc')}
                  align="center"
                >
                  <div className="sparo-func-agent-config__row-control">
                    <Button
                      className="sparo-func-agent-config__row-action-btn"
                      size="small"
                      variant="secondary"
                      disabled={browserControlBusy}
                      onClick={() => void handleBrowserControlCreateLauncher()}
                    >
                      {t('browserControl.createLauncher')}
                    </Button>
                  </div>
                </ConfigPageRow>
              )}
            </>
          ) : null}
        </ConfigPageSection>

        <Dialog
          open={browserRestartPrompt !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !browserControlBusy) {
              setBrowserRestartPrompt(null);
            }
          }}
          title={t('browserControl.restartModal.title')}
          size="small"
          closeOnOverlayClick={!browserControlBusy}
        >
          <div className="sparo-debug-config__modal-body">
            <p>{t('browserControl.restartModal.description', { browser: browserRestartPrompt?.browserKind || browserKind })}</p>
            <p>{t('browserControl.restartModal.warning')}</p>
            {browserRestartPrompt?.message ? (
              <p className="sparo-func-agent-config__hint">{browserRestartPrompt.message}</p>
            ) : null}
          </div>
          <div className="sparo-debug-config__modal-footer">
            <Button
              variant="secondary"
              size="small"
              onClick={() => setBrowserRestartPrompt(null)}
              disabled={browserControlBusy}
            >
              {t('browserControl.restartModal.cancel')}
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={() => void handleBrowserControlRestart()}
              disabled={browserControlBusy}
            >
              {browserControlBusy
                ? t('browserControl.restartModal.restarting')
                : t('browserControl.restartModal.confirm')}
            </Button>
          </div>
        </Dialog>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default PermissionsConfig;
