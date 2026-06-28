import React from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import type { SurfaceComponentMeta } from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import { renderSurfaceComponentIcon } from '../surfaceComponentIconHelpers';
import { useI18n } from '@/infrastructure/i18n';
import { Badge, IconButton, StatusDot } from '@/design-system';
import { resolveSurfaceComponentMeta } from '../surfaceComponentI18n';
import './SurfaceComponentCard.scss';

interface SurfaceComponentCardProps {
  app: SurfaceComponentMeta;
  index?: number;
  isRunning?: boolean;
  onOpenDetails: (app: SurfaceComponentMeta) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onStop?: (id: string) => void;
}

const SurfaceComponentCard: React.FC<SurfaceComponentCardProps> = ({
  app,
  index = 0,
  isRunning = false,
  onOpenDetails,
  onOpen,
  onDelete,
  onStop,
}) => {
  const { t, currentLanguage } = useI18n('scenes/apps');
  const displayMeta = resolveSurfaceComponentMeta(app, currentLanguage);
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
        'surface-component-card',
        isRunning && 'surface-component-card--running',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        '--card-index': index,
        '--surface-component-card-gradient': isRunning
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--ds-status-surface-success-fg) 28%, transparent) 0%, color-mix(in srgb, var(--ds-status-surface-success-fg) 18%, transparent) 100%)'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--ds-chat-accent) 28%, transparent) 0%, color-mix(in srgb, var(--ds-tool-family-agent-fg) 18%, transparent) 100%)',
      } as React.CSSProperties}
      onClick={handleOpenDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleOpenDetails()}
      aria-label={displayMeta.name}
    >
      <div className="surface-component-card__header">
        <div className="surface-component-card__icon-area">
          <div className="surface-component-card__icon">
            {renderSurfaceComponentIcon(app.icon || 'surface-component', 20)}
          </div>
        </div>
        <div className="surface-component-card__title-group">
          <span className="surface-component-card__name">{displayMeta.name}</span>
          <span className="surface-component-card__version">v{app.version}</span>
        </div>
        {isRunning && (
          <StatusDot
            className="surface-component-card__run-dot"
            tone="success"
            label={t('surfaceComponent.status.running')}
            pulse
          />
        )}
      </div>

      <div className="surface-component-card__body">
        {displayMeta.description ? (
          <div className="surface-component-card__desc">
            <span className="surface-component-card__desc-inner">{displayMeta.description}</span>
          </div>
        ) : null}
        {displayMeta.tags.length > 0 ? (
          <div className="surface-component-card__tags">
            {displayMeta.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="neutral" className="surface-component-card__tag">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="surface-component-card__footer">
        <div className="surface-component-card__actions" onClick={(e) => e.stopPropagation()}>
          <IconButton
            className="surface-component-card__action"
            onClick={handleOpenClick}
            aria-label={t('surfaceComponent.card.start')}
            title={t('surfaceComponent.card.start')}
            tooltip={t('surfaceComponent.card.start')}
            size="small"
            variant="primary"
          >
            <Play size={15} fill="currentColor" strokeWidth={0} />
          </IconButton>
          {isRunning && onStop ? (
            <IconButton
              className="surface-component-card__action"
              onClick={handleStopClick}
              aria-label={t('surfaceComponent.card.stop')}
              title={t('surfaceComponent.card.stop')}
              tooltip={t('surfaceComponent.card.stop')}
              size="small"
              variant="success"
            >
              <Square size={13} />
            </IconButton>
          ) : (
            <IconButton
              className="surface-component-card__action"
              onClick={handleDeleteClick}
              aria-label={t('surfaceComponent.card.delete')}
              title={t('surfaceComponent.card.delete')}
              tooltip={t('surfaceComponent.card.delete')}
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

export default SurfaceComponentCard;
