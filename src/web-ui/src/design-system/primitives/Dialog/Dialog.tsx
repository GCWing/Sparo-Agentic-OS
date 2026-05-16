import React, { forwardRef, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from './useBodyScrollLock';
import { useDialogFocusTrap } from './useDialogFocusTrap';
import './Dialog.scss';

export type DialogSize = 'small' | 'medium' | 'large' | 'xlarge';
export type DialogPlacement = 'center' | 'bottom-left' | 'bottom-right';

export interface DialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  titleExtra?: React.ReactNode;
  children: React.ReactNode;
  size?: DialogSize;
  placement?: DialogPlacement;
  contentInset?: boolean;
  contentClassName?: string;
  className?: string;
  overlayClassName?: string;
  showCloseButton?: boolean;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
  restoreFocus?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
  closeLabel?: string;
  role?: 'dialog' | 'alertdialog';
}

export interface DialogHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  titleExtra?: React.ReactNode;
}

export type DialogBodyProps = React.HTMLAttributes<HTMLDivElement>;
export type DialogFooterProps = React.HTMLAttributes<HTMLDivElement>;

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function isDialogStructure(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) {
      return false;
    }

    const childType = child.type as { displayName?: string };
    return (
      childType.displayName === 'DialogHeader' ||
      childType.displayName === 'DialogBody' ||
      childType.displayName === 'DialogFooter'
    );
  });
}

export const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ title, titleExtra, className, children, ...props }, ref) => (
    <div ref={ref} className={cx('ds-dialog__header', className)} {...props}>
      {(title || titleExtra) && (
        <div className="ds-dialog__title-group">
          {title && <h2 className="ds-dialog__title">{title}</h2>}
          {titleExtra && <span className="ds-dialog__title-extra">{titleExtra}</span>}
        </div>
      )}
      {children}
    </div>
  )
);

DialogHeader.displayName = 'DialogHeader';

export const DialogBody = forwardRef<HTMLDivElement, DialogBodyProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cx('ds-dialog__body', className)} {...props} />
  )
);

DialogBody.displayName = 'DialogBody';

export const DialogFooter = forwardRef<HTMLDivElement, DialogFooterProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cx('ds-dialog__footer', className)} {...props} />
  )
);

DialogFooter.displayName = 'DialogFooter';

export function Dialog({
  open,
  onOpenChange,
  title,
  titleExtra,
  children,
  size = 'medium',
  placement = 'center',
  contentInset = false,
  contentClassName,
  className,
  overlayClassName,
  showCloseButton = true,
  closeOnEscape = true,
  closeOnOverlayClick = true,
  restoreFocus = true,
  initialFocusRef,
  labelledBy,
  describedBy,
  ariaLabel,
  closeLabel = 'Close dialog',
  role = 'dialog',
}: DialogProps): React.ReactPortal | null {
  const dialogOpen = open;
  const dialogRef = useRef<HTMLDivElement>(null);
  const generatedTitleId = useId();
  const titleId = labelledBy ?? (title ? generatedTitleId : undefined);

  const closeDialog = () => {
    onOpenChange?.(false);
  };

  useBodyScrollLock(dialogOpen);
  useDialogFocusTrap({
    enabled: dialogOpen,
    containerRef: dialogRef,
    initialFocusRef,
    restoreFocus,
    onEscape: closeOnEscape ? closeDialog : undefined,
  });

  if (!dialogOpen) {
    return null;
  }

  const hasStructuredChildren = isDialogStructure(children);

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      closeDialog();
    }
  };

  return createPortal(
    <div
      className={cx(
        'ds-dialog-overlay',
        placement !== 'center' && `ds-dialog-overlay--${placement}`,
        overlayClassName
      )}
      onMouseDown={handleOverlayClick}
    >
      <div
        ref={dialogRef}
        className={cx(
          'ds-dialog',
          `ds-dialog--${size}`,
          contentInset && 'ds-dialog--content-inset',
          showCloseButton && 'ds-dialog--with-close',
          className
        )}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {(title || titleExtra || showCloseButton) && (
          <div
            className={cx(
              'ds-dialog__header-shell',
              !title && showCloseButton && 'ds-dialog__header-shell--close-only'
            )}
          >
            {(title || titleExtra) && (
              <DialogHeader id={titleId} title={title} titleExtra={titleExtra} />
            )}
            {showCloseButton && (
              <button
                className="ds-dialog__close"
                type="button"
                aria-label={closeLabel}
                onClick={closeDialog}
              >
                <X aria-hidden="true" size={14} strokeWidth={2} />
              </button>
            )}
          </div>
        )}
        {hasStructuredChildren ? (
          children
        ) : (
          <DialogBody className={cx(contentInset && 'ds-dialog__body--inset', contentClassName)}>
            {children}
          </DialogBody>
        )}
      </div>
    </div>,
    document.body
  );
}
