/**
 * About dialog — product identity, release metadata, and project resources.
 */

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/infrastructure/i18n';
import { systemAPI } from '@/infrastructure/api';
import {
  Button,
  FloatingCard,
  IconButton,
  useBodyScrollLock,
  useDialogFocusTrap,
} from '@/design-system';
import {
  ArrowUpRight,
  BookOpen,
  Bug,
  Check,
  Clock3,
  Copy,
  GitBranch,
  Github,
  Hash,
} from 'lucide-react';
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
  const cardRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(isOpen);
  useDialogFocusTrap({
    enabled: isOpen,
    containerRef: cardRef,
    initialFocusRef: cardRef,
    onEscape: onClose,
  });

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

  const buildItems = [
    {
      key: 'build-date',
      icon: Clock3,
      label: t('about.buildDate'),
      value: buildDateLabel,
      isMonospace: false,
    },
    version.gitCommit
      ? {
          key: 'commit',
          icon: Hash,
          label: t('about.commit'),
          value: version.gitCommit.slice(0, 7),
          isMonospace: true,
        }
      : null,
    version.gitBranch
      ? {
          key: 'branch',
          icon: GitBranch,
          label: t('about.branch'),
          value: version.gitBranch,
          isMonospace: true,
        }
      : null,
  ].filter((item): item is {
    key: string;
    icon: typeof Clock3;
    label: string;
    value: string;
    isMonospace: boolean;
  } => item !== null);

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="sparo-about-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <FloatingCard
        ref={cardRef}
        className="sparo-about-dialog"
        padding="spacious"
        onDismiss={onClose}
        dismissLabel={t('about.close')}
        dismissTooltip={t('about.close')}
        role="dialog"
        aria-modal="true"
        aria-label={t('about.productTitle')}
        tabIndex={-1}
      >
        <div className="sparo-about-dialog__main">
          <section className="sparo-about-dialog__brand-panel" aria-label={t('about.productTitle')}>
            <img
              className="sparo-about-dialog__logo"
              src="/sparo-logo-mark.png"
              alt=""
              draggable={false}
            />
          </section>

          <section className="sparo-about-dialog__details">
            <header className="sparo-about-dialog__identity">
              <div className="sparo-about-dialog__title-line">
                <h1 className="sparo-about-dialog__title">{t('about.productTitle')}</h1>
                <span className="sparo-about-dialog__version">
                  {t('about.version', { version: versionLabel })}
                </span>
              </div>
              <p className="sparo-about-dialog__tagline">{t('about.tagline')}</p>
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
                  onClick={copyDiagnostics}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </IconButton>
              </div>

              <dl className="sparo-about-dialog__build-list">
                {buildItems.map(({ key, icon: Icon, label, value, isMonospace }) => (
                  <div key={key} className="sparo-about-dialog__build-item">
                    <span className="sparo-about-dialog__build-icon" aria-hidden="true">
                      <Icon size={24} strokeWidth={1.7} />
                    </span>
                    <div className="sparo-about-dialog__build-copy">
                      <dt>{label}</dt>
                      <dd className={isMonospace ? 'sparo-about-dialog__build-value--mono' : undefined}>
                        {value}
                      </dd>
                    </div>
                  </div>
                ))}
              </dl>
            </section>
          </section>
        </div>

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
                  <Icon size={14} aria-hidden="true" />
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
      </FloatingCard>
    </div>,
    document.body,
  );
};

export default AboutDialog;
