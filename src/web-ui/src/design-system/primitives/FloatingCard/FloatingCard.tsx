import React, { forwardRef } from 'react';
import { X } from 'lucide-react';
import { IconButton, type IconButtonProps } from '../IconButton';
import './FloatingCard.scss';

export type FloatingCardPadding = 'compact' | 'default' | 'spacious';

export interface FloatingCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onDismiss'> {
  /** Interior spacing owned by the floating-surface contract. */
  padding?: FloatingCardPadding;
  /** Adds the standard circular dismiss affordance. */
  onDismiss?: () => void;
  /** Accessible name for the dismiss command. Localized surfaces should pass translated copy. */
  dismissLabel?: string;
  /** Optional tooltip for the dismiss command. */
  dismissTooltip?: React.ReactNode;
  /** Optional ref for focus management when the card is composed into a dialog workflow. */
  dismissButtonRef?: React.Ref<HTMLButtonElement>;
}

export type FloatingCardActionProps = IconButtonProps;

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Circular filled icon command for actions placed inside a FloatingCard. */
export const FloatingCardAction = forwardRef<HTMLButtonElement, FloatingCardActionProps>(({
  className,
  size = 'xs',
  shape = 'circle',
  variant = 'ghost',
  ...props
}, ref) => (
  <IconButton
    ref={ref}
    className={cx('ds-floating-card__action', className)}
    size={size}
    shape={shape}
    variant={variant}
    {...props}
  />
));

FloatingCardAction.displayName = 'FloatingCardAction';

/**
 * Non-modal elevated surface for transient notifications, anchored popups,
 * and other lightweight cards. Use Dialog when focus trapping or an overlay is required.
 */
export const FloatingCard = forwardRef<HTMLDivElement, FloatingCardProps>(({
  children,
  className,
  padding = 'default',
  onDismiss,
  dismissLabel = 'Dismiss floating card',
  dismissTooltip,
  dismissButtonRef,
  ...props
}, ref) => (
  <div
    ref={ref}
    className={cx(
      'ds-floating-card',
      `ds-floating-card--padding-${padding}`,
      Boolean(onDismiss) && 'ds-floating-card--dismissible',
      className,
    )}
    {...props}
  >
    {children}
    {onDismiss && (
      <FloatingCardAction
        ref={dismissButtonRef}
        className="ds-floating-card__dismiss"
        type="button"
        size="xs"
        shape="circle"
        variant="ghost"
        aria-label={dismissLabel}
        tooltip={dismissTooltip}
        onClick={onDismiss}
      >
        <X aria-hidden="true" size={14} strokeWidth={2} />
      </FloatingCardAction>
    )}
  </div>
));

FloatingCard.displayName = 'FloatingCard';
