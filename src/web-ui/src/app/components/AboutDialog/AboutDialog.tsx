/**
 * About dialog — "ignition plaque" for Sparo OS.
 * Three zones: brand stage (story), spec sheet (facts), link rail (index).
 */

import React, { useCallback, useRef, useState } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import { systemAPI } from '@/infrastructure/api';
import { Badge, Dialog, IconButton, Panel, PanelBody } from '@/design-system';
import { Bug, BookOpen, Calendar, Check, Copy, Github, GitBranch, GitCommit } from 'lucide-react';
import {
  getAboutInfo,
  formatVersion,
  formatBuildDate
} from '@/shared/utils/version';
import { createLogger } from '@/shared/utils/logger';
import './AboutDialog.scss';

const log = createLogger('AboutDialog');

interface AboutDialogProps {
  /** Whether visible */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
}

/** Reset delay for the click-to-pulse mark interaction. */
const MARK_PULSE_RESET_MS = 500;

export const AboutDialog: React.FC<AboutDialogProps> = ({
  isOpen,
  onClose
}) => {
  const { t } = useI18n('common');
  const [copied, setCopied] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aboutInfo = getAboutInfo();
  const { version, license, links } = aboutInfo;
  const versionLabel = formatVersion(version.version, version.isDev);
  const buildDateLabel = formatBuildDate(version.buildDate);

  const diagnosticParts = [
    `Sparo OS ${versionLabel}`,
    buildDateLabel,
    version.gitCommit,
    version.gitBranch
  ].filter(Boolean);
  const diagnosticText = diagnosticParts.join(' · ');

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      log.error('Failed to copy diagnostics', err);
    }
  };

  const handleMarkClick = useCallback(() => {
    // Restart the animation even if it is already playing.
    setPulsing(false);
    requestAnimationFrame(() => setPulsing(true));

    if (pulseTimeoutRef.current) {
      clearTimeout(pulseTimeoutRef.current);
    }
    pulseTimeoutRef.current = setTimeout(() => setPulsing(false), MARK_PULSE_RESET_MS);
  }, []);

  const openLink = (href?: string) => {
    if (!href) {
      return;
    }
    systemAPI.openExternal(href).catch((error) => {
      log.error('Failed to open external link', { href, error });
    });
  };

  const linkItems = [
    { key: 'repository', href: links.repository, icon: Github, label: t('about.links.repository') },
    { key: 'documentation', href: links.documentation, icon: BookOpen, label: t('about.links.documentation') },
    { key: 'issues', href: links.issues, icon: Bug, label: t('about.links.issues') }
  ].filter((item): item is { key: string; href: string; icon: typeof Github; label: string } => Boolean(item.href));

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      showCloseButton={true}
      size="medium"
      ariaLabel={t('about.productTitle')}
      closeLabel={t('about.close')}
      overlayClassName="sparo-about-dialog-overlay"
      contentClassName="sparo-about-dialog__dialog-body"
    >
      <div className="sparo-about-dialog">
        {/* Zone A — brand stage */}
        <div className="sparo-about-dialog__stage">
          <button
            type="button"
            className={[
              'sparo-about-dialog__mark',
              pulsing && 'sparo-about-dialog__mark--active'
            ].filter(Boolean).join(' ')}
            onClick={handleMarkClick}
            aria-label={t('about.productTitle')}
          >
            <img
              className="sparo-about-dialog__logo"
              src="/sparo-logo-mark.png"
              alt=""
              draggable={false}
            />
            <span className="sparo-about-dialog__mark-ring" aria-hidden="true" />
          </button>

          <h1 className="sparo-about-dialog__title">{t('about.productTitle')}</h1>
          <p className="sparo-about-dialog__tagline">{t('about.tagline')}</p>
          <Badge variant="accent" className="sparo-about-dialog__version-badge">
            {t('about.version', { version: versionLabel })}
          </Badge>
        </div>

        {/* Zone B — spec sheet */}
        <Panel variant="subtle" className="sparo-about-dialog__specsheet">
          <PanelBody className="sparo-about-dialog__specsheet-body">
            <div className="sparo-about-dialog__specsheet-header">
              <span className="sparo-about-dialog__specsheet-title">{t('about.specSheetTitle')}</span>
              <IconButton
                aria-label={t('about.copyDiagnostics')}
                tooltip={copied ? t('about.copied') : t('about.copyDiagnostics')}
                size="xs"
                variant="ghost"
                className="sparo-about-dialog__specsheet-copy"
                onClick={copyDiagnostics}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </IconButton>
            </div>

            <dl className="sparo-about-dialog__specsheet-list">
              <div className="sparo-about-dialog__specsheet-row">
                <dt>
                  <Calendar size={13} aria-hidden="true" />
                  <span>{t('about.buildDate')}</span>
                </dt>
                <dd className="sparo-about-dialog__specsheet-value--mono">{buildDateLabel}</dd>
              </div>
              {version.gitCommit && (
                <div className="sparo-about-dialog__specsheet-row">
                  <dt>
                    <GitCommit size={13} aria-hidden="true" />
                    <span>{t('about.commit')}</span>
                  </dt>
                  <dd className="sparo-about-dialog__specsheet-value--mono">
                    {version.gitCommit.slice(0, 7)}
                  </dd>
                </div>
              )}
              {version.gitBranch && (
                <div className="sparo-about-dialog__specsheet-row">
                  <dt>
                    <GitBranch size={13} aria-hidden="true" />
                    <span>{t('about.branch')}</span>
                  </dt>
                  <dd>{version.gitBranch}</dd>
                </div>
              )}
            </dl>
          </PanelBody>
        </Panel>

        {/* Zone C — link rail + footer */}
        {linkItems.length > 0 && (
          <div className="sparo-about-dialog__links">
            {linkItems.map(({ key, href, icon: Icon, label }) => (
              <IconButton
                key={key}
                aria-label={label}
                tooltip={label}
                size="small"
                variant="ghost"
                className="sparo-about-dialog__link-btn"
                onClick={() => openLink(href)}
              >
                <Icon size={15} aria-hidden="true" />
              </IconButton>
            ))}
          </div>
        )}

        <footer className="sparo-about-dialog__footer">
          <button
            type="button"
            className="sparo-about-dialog__license"
            onClick={() => openLink(license.url)}
          >
            {t('about.licenseLabel', { type: license.type })}
          </button>
          <p className="sparo-about-dialog__copyright">{t('about.copyright')}</p>
        </footer>
      </div>
    </Dialog>
  );
};

export default AboutDialog;
