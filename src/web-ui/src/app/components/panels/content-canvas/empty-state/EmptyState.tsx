/**
 * EmptyState component.
 * Empty state display.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { EmptyState as DesignEmptyState, IconButton } from '@/design-system';
import './EmptyState.scss';

export interface EmptyStateProps {
  onClose?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onClose }) => {
  const { t } = useTranslation('components');

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.();
  }, [onClose]);

  return (
    <div className="canvas-empty-state">
      {onClose && (
        <div className="canvas-empty-state__toolbar">
          <IconButton
            onClick={handleClose}
            size="xs"
            variant="ghost"
            aria-label={t('tabs.close')}
            tooltip={t('tabs.close')}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      <div className="canvas-empty-state__content">
        <DesignEmptyState
          description={t('canvas.noContentOpen')}
          imageSize="small"
        />
      </div>
    </div>
  );
};

EmptyState.displayName = 'EmptyState';

export default EmptyState;
