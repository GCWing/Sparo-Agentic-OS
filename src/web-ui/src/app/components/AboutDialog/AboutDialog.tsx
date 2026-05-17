/**
 * About dialog component.
 * Shows app version and license info.
 * Uses the design-system Dialog primitive.
 */

import React, { useState } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import { Badge, Dialog, IconButton, Panel, PanelBody } from '@/design-system';
import { Copy, Check } from 'lucide-react';
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
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const aboutInfo = getAboutInfo();
  const { version, license } = aboutInfo;

  const copyToClipboard = async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(itemId);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch (err) {
      log.error('Failed to copy to clipboard', err);
    }
  };

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
      overlayClassName="sparo-about-dialog-overlay"
    >
      <div className="sparo-about-dialog__content">
        {/* Hero section - product info */}
        <div className="sparo-about-dialog__hero">
          <h1 className="sparo-about-dialog__title">{t('about.productTitle')}</h1>
          <Badge variant="neutral" className="sparo-about-dialog__version-badge">
            {t('about.version', { version: formatVersion(version.version, version.isDev) })}
          </Badge>
          <div className="sparo-about-dialog__divider" />
        </div>

        {/* Scrollable area */}
        <div className="sparo-about-dialog__scrollable">
          <div className="sparo-about-dialog__info-section">
            <Panel variant="subtle" className="sparo-about-dialog__info-card">
              <PanelBody className="sparo-about-dialog__info-card-body">
                <div className="sparo-about-dialog__info-row">
                  <span className="sparo-about-dialog__info-label">{t('about.buildDate')}</span>
                  <span className="sparo-about-dialog__info-value">
                    {formatBuildDate(version.buildDate)}
                  </span>
                </div>

                {version.gitCommit && (
                  <div className="sparo-about-dialog__info-row">
                    <span className="sparo-about-dialog__info-label">{t('about.commit')}</span>
                    <div className="sparo-about-dialog__info-value-group">
                      <span className="sparo-about-dialog__info-value sparo-about-dialog__info-value--mono">
                        {version.gitCommit}
                      </span>
                      <IconButton
                        aria-label={t('about.copy')}
                        tooltip={t('about.copy')}
                        size="xs"
                        variant="ghost"
                        onClick={() => copyToClipboard(version.gitCommit || '', 'commit')}
                      >
                        {copiedItem === 'commit' ? <Check size={12} /> : <Copy size={12} />}
                      </IconButton>
                    </div>
                  </div>
                )}

                {version.gitBranch && (
                  <div className="sparo-about-dialog__info-row">
                    <span className="sparo-about-dialog__info-label">{t('about.branch')}</span>
                    <span className="sparo-about-dialog__info-value">{version.gitBranch}</span>
                  </div>
                )}
              </PanelBody>
            </Panel>
          </div>
        </div>

        {/* Footer */}
        <div className="sparo-about-dialog__footer">
          <p className="sparo-about-dialog__license">{license.text}</p>
          <p className="sparo-about-dialog__copyright">
            {t('about.copyright')}
          </p>
        </div>
      </div>
    </Dialog>
  );
};

export default AboutDialog;
