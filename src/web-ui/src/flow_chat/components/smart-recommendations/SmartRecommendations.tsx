/**
 * Smart recommendations component
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { recommendationRegistry } from './RecommendationRegistry';
import { RecommendationAction, RecommendationContext } from './types';
import { Button, IconButton } from '@/design-system';
import { createLogger } from '@/shared/utils/logger';
import './SmartRecommendations.scss';

const log = createLogger('SmartRecommendations');

export interface SmartRecommendationsProps {
  /** Recommendation context */
  context: RecommendationContext;
  /** Optional class name */
  className?: string;
}

export const SmartRecommendations: React.FC<SmartRecommendationsProps> = ({
  context,
  className = ''
}) => {
  const { t } = useTranslation('flow-chat');
  const [actions, setActions] = useState<RecommendationAction[]>([]);
  const [visible, setVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const loadRecommendations = useCallback(async () => {
    try {
      const providers = recommendationRegistry.getAllProviders();

      const allActions: RecommendationAction[] = [];

      for (const provider of providers) {
        try {
          const shouldShow = await provider.shouldShow(context);

          if (shouldShow) {
            const providerActions = await provider.getActions(context);
            allActions.push(...providerActions);
          }
        } catch (error) {
          log.error('Provider error', { providerId: provider.id, error });
        }
      }

      setActions(allActions);
      setVisible(allActions.length > 0);
    } catch (error) {
      log.error('Failed to load recommendations', error);
      setVisible(false);
    }
  }, [context]);

  useEffect(() => {
    // Delay loading to avoid frequent refresh
    const timer = setTimeout(() => {
      loadRecommendations();
    }, 500);

    return () => clearTimeout(timer);
  }, [loadRecommendations]);

  const handleActionClick = useCallback(async (action: RecommendationAction) => {
    if (action.disabled || actionLoading[action.id]) {
      return;
    }

    setActionLoading(prev => ({ ...prev, [action.id]: true }));
    try {
      await action.onClick();
      // Reload after action completes in case state changed
      setTimeout(() => {
        loadRecommendations();
      }, 1000);
    } catch (error) {
      log.error('Action execution failed', { actionId: action.id, error });
    } finally {
      setActionLoading(prev => ({ ...prev, [action.id]: false }));
    }
  }, [actionLoading, loadRecommendations]);

  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  if (!visible || actions.length === 0) {
    return null;
  }

  return (
    <div className={`sparo-smart-recommendations ${className}`}>
      <div className="sparo-smart-recommendations__header">
        <span className="sparo-smart-recommendations__title">{t('smartRecommendations.title')}</span>
        <IconButton
          className="sparo-smart-recommendations__close"
          onClick={handleClose}
          aria-label={t('smartRecommendations.close')}
          tooltip={t('smartRecommendations.close')}
          size="xs"
          variant="ghost"
        >
          <X size={16} />
        </IconButton>
      </div>

      <div className="sparo-smart-recommendations__actions">
        {actions.map(action => {
          const IconComponent = action.icon 
            ? (LucideIcons as any)[action.icon] 
            : null;
          
          const isLoading = actionLoading[action.id] || action.loading;
          
          return (
            <Button
              key={action.id}
              className={`sparo-smart-recommendations__action sparo-smart-recommendations__action--${action.type || 'secondary'}`}
              onClick={() => handleActionClick(action)}
              disabled={action.disabled || isLoading}
              title={action.description}
              type="button"
              variant={action.type === 'primary' ? 'primary' : action.type === 'danger' ? 'danger' : 'secondary'}
              size="small"
            >
              {IconComponent && <IconComponent size={16} />}
              <span>{action.label}</span>
              {isLoading && <span className="sparo-smart-recommendations__loading">...</span>}
            </Button>
          );
        })}
      </div>
    </div>
  );
};

