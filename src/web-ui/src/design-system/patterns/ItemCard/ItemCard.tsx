import React, { forwardRef } from 'react';
import './ItemCard.scss';

export type ItemCardStatus = 'idle' | 'active' | 'running' | 'error';

export interface ItemCardProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: ItemCardStatus;
  interactive?: boolean;
  highlighted?: boolean;
  onActivate?: () => void;
  onDelete?: () => void;
}

export const ItemCard = forwardRef<HTMLDivElement, ItemCardProps>(
  ({
    status = 'idle',
    interactive = true,
    highlighted = false,
    onActivate,
    onDelete,
    className = '',
    children,
    tabIndex,
    role,
    onClick,
    onKeyDown,
    ...props
  }, ref) => {
    const isInteractive = interactive || Boolean(onActivate);

    return (
      <div
        ref={ref}
        className={[
          'ds-item-card',
          `ds-item-card--${status}`,
          isInteractive && 'ds-item-card--interactive',
          highlighted && 'is-highlighted',
          className,
        ].filter(Boolean).join(' ')}
        role={role ?? (isInteractive ? 'button' : undefined)}
        tabIndex={tabIndex ?? (isInteractive ? 0 : undefined)}
        aria-current={highlighted ? 'true' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onActivate?.();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if ((event.key === 'Enter' || event.key === ' ') && onActivate) {
            event.preventDefault();
            onActivate();
          }
          if (event.key === 'Delete' && onDelete) {
            event.preventDefault();
            onDelete();
          }
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ItemCard.displayName = 'ItemCard';

export type ItemCardSectionProps = React.HTMLAttributes<HTMLDivElement>;
export type ItemCardSpanProps = React.HTMLAttributes<HTMLSpanElement>;

export const ItemCardTop = forwardRef<HTMLDivElement, ItemCardSectionProps>(
  ({ className = '', children, ...props }, ref) => (
    <div ref={ref} className={['ds-item-card__top', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

ItemCardTop.displayName = 'ItemCardTop';

export const ItemCardTitle = forwardRef<HTMLSpanElement, ItemCardSpanProps>(
  ({ className = '', children, ...props }, ref) => (
    <span ref={ref} className={['ds-item-card__title', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </span>
  )
);

ItemCardTitle.displayName = 'ItemCardTitle';

export const ItemCardMeta = forwardRef<HTMLDivElement, ItemCardSectionProps>(
  ({ className = '', children, ...props }, ref) => (
    <div ref={ref} className={['ds-item-card__meta', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

ItemCardMeta.displayName = 'ItemCardMeta';

export const ItemCardMetaItem = forwardRef<HTMLSpanElement, ItemCardSpanProps>(
  ({ className = '', children, ...props }, ref) => (
    <span ref={ref} className={['ds-item-card__meta-item', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </span>
  )
);

ItemCardMetaItem.displayName = 'ItemCardMetaItem';

export const ItemCardMetaSeparator: React.FC<ItemCardSpanProps> = ({ className = '', children = '·', ...props }) => (
  <span className={['ds-item-card__meta-separator', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </span>
);

export interface ItemCardActionsProps extends ItemCardSectionProps {
  composing?: boolean;
}

export const ItemCardActions = forwardRef<HTMLDivElement, ItemCardActionsProps>(
  ({ className = '', composing = false, children, ...props }, ref) => (
    <div
      ref={ref}
      className={[
        'ds-item-card__actions',
        composing && 'ds-item-card__actions--composing',
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </div>
  )
);

ItemCardActions.displayName = 'ItemCardActions';
