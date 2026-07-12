/**
 * About dialog — a compact system identity card for Sparo OS.
 */

import React, { useState } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import { systemAPI } from '@/infrastructure/api';
import { Badge, Button, Dialog, IconButton } from '@/design-system';
import { ArrowUpRight, Bug, BookOpen, Check, Copy, Github } from 'lucide-react';
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

export const AboutDialog: React.FC<AboutDialogProps> = ({
  isOpen,
  onClose
}) => {
  const { t } = useI18n('common');
  const [copied, setCopied] = useState(false);

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
        <header className="sparo-about-dialog__identity">
          <div className="sparo-about-dialog__mark" aria-hidden="true">
            <img
              className="sparo-about-dialog__logo"
              src="/sparo-logo-mark.png"
              alt=""
              draggable={false}
            />
          </div>

          <div className="sparo-about-dialog__identity-copy">
            <div className="sparo-about-dialog__title-line">
              <h1 className="sparo-about-dialog__title">{t('about.productTitle')}</h1>
              <Badge variant="accent" className="sparo-about-dialog__version-badge">
                {t('about.version', { version: versionLabel })}
              </Badge>
            </div>
            <p className="sparo-about-dialog__tagline">{t('about.tagline')}</p>
          </div>
        </header>

        <section className="sparo-about-dialog__build" aria-labelledby="sparo-about-build-title">
          <div className="sparo-about-dialog__build-header">
            <span id="sparo-about-build-title" className="sparo-about-dialog__build-title">
              {t('about.specSheetTitle')}
            </span>
            <IconButton
              aria-label={t('about.copyDiagnostics')}
              tooltip={copied ? t('about.copied') : t('about.copyDiagnostics')}
              size="xs"
              variant="ghost"
              className="sparo-about-dialog__build-copy"
              onClick={copyDiagnostics}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </IconButton>
          </div>

          <dl className="sparo-about-dialog__build-grid">
            <div className="sparo-about-dialog__build-item">
              <dt>{t('about.buildDate')}</dt>
              <dd>{buildDateLabel}</dd>
            </div>
            {version.gitCommit && (
              <div className="sparo-about-dialog__build-item">
                <dt>{t('about.commit')}</dt>
                <dd>{version.gitCommit.slice(0, 7)}</dd>
              </div>
            )}
            {version.gitBranch && (
              <div className="sparo-about-dialog__build-item">
                <dt>{t('about.branch')}</dt>
                <dd>{version.gitBranch}</dd>
              </div>
            )}
          </dl>
        </section>

        {linkItems.length > 0 && (
          <div className="sparo-about-dialog__links">
            {linkItems.map(({ key, href, icon: Icon, label }) => (
              <div key={key} className="sparo-about-dialog__link-cell">
                <Button
                  size="small"
                  variant="ghost"
                  className="sparo-about-dialog__link"
                  onClick={() => openLink(href)}
                >
                  <span className="sparo-about-dialog__link-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span className="sparo-about-dialog__link-label">{label}</span>
                  <ArrowUpRight
                    className="sparo-about-dialog__link-arrow"
                    size={12}
                    aria-hidden="true"
                  />
                </Button>
              </div>
            ))}
          </div>
        )}

        <footer className="sparo-about-dialog__footer">
          <Button
            size="small"
            variant="ghost"
            className="sparo-about-dialog__license"
            onClick={() => openLink(license.url)}
          >
            {t('about.licenseLabel', { type: license.type })}
          </Button>
          <p className="sparo-about-dialog__copyright">{t('about.copyright')}</p>
        </footer>
      </div>
    </Dialog>
  );
};

export default AboutDialog;
