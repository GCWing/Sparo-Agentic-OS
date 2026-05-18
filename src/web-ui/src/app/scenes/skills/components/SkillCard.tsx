import React from 'react';
import { BookOpen, Package } from 'lucide-react';
import {
  Button,
  IconButton,
  ItemCard,
  ItemCardActions,
  ItemCardMeta,
  ItemCardTitle,
  ItemCardTop,
} from '@/design-system';
import './SkillCard.scss';

type SkillCardActionTone = 'primary' | 'danger' | 'success' | 'muted';

export interface SkillCardAction {
  id: string;
  icon: React.ReactNode;
  ariaLabel: string;
  label?: string;
  title?: string;
  disabled?: boolean;
  tone?: SkillCardActionTone;
  onClick: () => void;
}

interface SkillCardProps {
  name: string;
  description?: string;
  index?: number;
  iconKind?: 'skill' | 'market';
  installed?: boolean;
  compact?: boolean;
  badges?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: SkillCardAction[];
  onOpenDetails?: () => void;
}

const SkillCard: React.FC<SkillCardProps> = ({
  name,
  description,
  index = 0,
  iconKind = 'skill',
  installed = false,
  compact = false,
  badges,
  meta,
  actions = [],
  onOpenDetails,
}) => {
  const Icon = iconKind === 'market' ? Package : BookOpen;

  return (
    <ItemCard
      className={[
        'skill-card',
        installed ? 'skill-card--installed' : '',
        compact ? 'skill-card--compact' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--card-index': index } as React.CSSProperties}
      status="idle"
      onActivate={onOpenDetails}
      aria-label={name}
    >
      <ItemCardTop className="skill-card__top">
        <span className="skill-card__icon" aria-hidden="true">
          <Icon size={18} strokeWidth={1.6} />
        </span>
        <ItemCardTitle className="skill-card__title">
          <span>{name}</span>
        </ItemCardTitle>
        {badges ? <span className="skill-card__badges">{badges}</span> : null}
      </ItemCardTop>

      <div className="skill-card__description">
        {description?.trim() && (
          <p className="skill-card__desc">{description.trim()}</p>
        )}
      </div>

      {meta ? (
        <ItemCardMeta className="skill-card__meta">
          {meta}
        </ItemCardMeta>
      ) : null}

      {actions.length > 0 && (
        <ItemCardActions className="skill-card__actions" onClick={(e) => e.stopPropagation()}>
          {actions.map((action) => (
            action.label ? (
              <Button
                key={action.id}
                variant={action.tone === 'muted' ? 'ghost' : action.tone === 'success' ? 'secondary' : (action.tone ?? 'secondary')}
                size="small"
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={action.ariaLabel}
                title={action.title ?? action.ariaLabel}
              >
                {action.icon}
                <span>{action.label}</span>
              </Button>
            ) : (
              <IconButton
                key={action.id}
                variant={action.tone === 'muted' ? 'ghost' : action.tone === 'success' ? 'success' : (action.tone === 'danger' ? 'danger' : 'ghost')}
                size="small"
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={action.ariaLabel}
                tooltip={action.title ?? action.ariaLabel}
              >
                {action.icon}
              </IconButton>
            )
          ))}
        </ItemCardActions>
      )}
    </ItemCard>
  );
};

export default SkillCard;
