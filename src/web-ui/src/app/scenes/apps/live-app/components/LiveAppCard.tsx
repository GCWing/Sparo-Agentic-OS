import React from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import type { LiveAppMeta } from '@/infrastructure/api/service-api/LiveAppAPI';
import { renderLiveAppIcon } from '../liveAppIconHelpers';
import { useI18n } from '@/infrastructure/i18n';
import { Badge, IconButton, StatusDot } from '@/design-system';
import { resolveLiveAppMeta } from '../liveAppI18n';
import './LiveAppCard.scss';

interface LiveAppCardProps {
  app: LiveAppMeta;
  index?: number;
  isRunning?: boolean;
  onOpenDetails: (app: LiveAppMeta) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onStop?: (id: string) => void;
}

const LiveAppCard: React.FC<LiveAppCardProps> = ({
  app,
  index = 0,
  isRunning = false,
  onOpenDetails,
  onOpen,
  onDelete,
  onStop,
}) => {
  const { t, currentLanguage } = useI18n('scenes/apps');
  const displayMeta = resolveLiveAppMeta(app, currentLanguage);
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(app.id);
  };

  const handleStopClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStop?.(app.id);
  };

  const handleOpenClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpen(app.id);
  };

  const handleOpenDetails = () => {
    onOpenDetails(app);
  };

  return (
    <div
      className={[
        'live-app-card',
        isRunning && 'live-app-card--running',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        '--card-index': index,
        '--live-app-card-gradient': isRunning
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--ds-status-surface-success-fg) 28%, transparent) 0%, color-mix(in srgb, var(--ds-status-surface-success-fg) 18%, transparent) 100%)'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--ds-chat-accent) 28%, transparent) 0%, color-mix(in srgb, var(--ds-tool-family-agent-app-fg) 18%, transparent) 100%)',
      } as React.CSSProperties}
      onClick={handleOpenDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleOpenDetails()}
      aria-label={displayMeta.name}
    >
      <div className="live-app-card__header">
        <div className="live-app-card__icon-area">
          <div className="live-app-card__icon">
            {renderLiveAppIcon(app.icon || 'live-app', 20)}
          </div>
        </div>
        <div className="live-app-card__title-group">
          <span className="live-app-card__name">{displayMeta.name}</span>
          <span className="live-app-card__version">v{app.version}</span>
        </div>
        {isRunning && (
          <StatusDot
            className="live-app-card__run-dot"
            tone="success"
            label={t('liveApp.status.running')}
            pulse
          />
        )}
      </div>

      <div className="live-app-card__body">
        {displayMeta.description ? (
          <div className="live-app-card__desc">
            <span className="live-app-card__desc-inner">{displayMeta.description}</span>
          </div>
        ) : null}
        {displayMeta.tags.length > 0 ? (
          <div className="live-app-card__tags">
            {displayMeta.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="neutral" className="live-app-card__tag">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="live-app-card__footer">
        <div className="live-app-card__actions" onClick={(e) => e.stopPropagation()}>
          <IconButton
            className="live-app-card__action"
            onClick={handleOpenClick}
            aria-label={t('liveApp.card.start')}
            title={t('liveApp.card.start')}
            tooltip={t('liveApp.card.start')}
            size="small"
            variant="primary"
          >
            <Play size={15} fill="currentColor" strokeWidth={0} />
          </IconButton>
          {isRunning && onStop ? (
            <IconButton
              className="live-app-card__action"
              onClick={handleStopClick}
              aria-label={t('liveApp.card.stop')}
              title={t('liveApp.card.stop')}
              tooltip={t('liveApp.card.stop')}
              size="small"
              variant="success"
            >
              <Square size={13} />
            </IconButton>
          ) : (
            <IconButton
              className="live-app-card__action"
              onClick={handleDeleteClick}
              aria-label={t('liveApp.card.delete')}
              title={t('liveApp.card.delete')}
              tooltip={t('liveApp.card.delete')}
              size="small"
              variant="danger"
            >
              <Trash2 size={13} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveAppCard;
