import React from 'react';
import { Badge, Button } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import './RemoteConnectDisclaimer.scss';

interface RemoteConnectDisclaimerContentProps {
  agreed: boolean;
  onClose: () => void;
  onAgree?: () => void;
}

export const RemoteConnectDisclaimerContent: React.FC<RemoteConnectDisclaimerContentProps> = ({
  agreed,
  onClose,
  onAgree,
}) => {
  const { t } = useI18n('common');
  const { t: tRemote } = useI18n('shell/remote-connect');
  const canAgree = !!onAgree && !agreed;

  return (
    <div className="bitfun-remote-disclaimer">
      <div className="bitfun-remote-disclaimer__meta">
        <Badge variant={agreed ? 'success' : 'warning'}>
          {tRemote(agreed ? 'disclaimerStatusAgreed' : 'disclaimerStatusPending')}
        </Badge>
      </div>

      <p className="bitfun-remote-disclaimer__text">{tRemote('disclaimerIntro')}</p>

      <ol className="bitfun-remote-disclaimer__list">
        <li>{tRemote('disclaimerItemGeneralRisk')}</li>
        <li>{tRemote('disclaimerItemSecurity')}</li>
        <li>{tRemote('disclaimerItemEncryption')}</li>
        <li>{tRemote('disclaimerItemOpenSource')}</li>
        <li>{tRemote('disclaimerItemPrivacy')}</li>
        <li>{tRemote('disclaimerItemDataUsage')}</li>
        <li>{tRemote('disclaimerItemCredentials')}</li>
        <li>{tRemote('disclaimerItemQrCode')}</li>
        <li>{tRemote('disclaimerItemNgrok')}</li>
        <li>{tRemote('disclaimerItemSelfHosted')}</li>
        <li>{tRemote('disclaimerItemNetwork')}</li>
        <li>{tRemote('disclaimerItemBot')}</li>
        <li>{tRemote('disclaimerItemBotPersistence')}</li>
        <li>{tRemote('disclaimerItemMobileBrowser')}</li>
        <li>{tRemote('disclaimerItemCompliance')}</li>
        <li>{tRemote('disclaimerItemLiability')}</li>
      </ol>

      <div className="bitfun-remote-disclaimer__actions">
        <Button
          type="button"
          variant="secondary"
          className="bitfun-remote-disclaimer__btn bitfun-remote-disclaimer__btn--secondary"
          onClick={onClose}
        >
          {canAgree ? tRemote('disclaimerDecline') : t('actions.close')}
        </Button>
        {canAgree && (
          <Button
            type="button"
            variant="primary"
            className="bitfun-remote-disclaimer__btn bitfun-remote-disclaimer__btn--primary"
            onClick={onAgree}
          >
            {tRemote('disclaimerAgree')}
          </Button>
        )}
      </div>
    </div>
  );
};
