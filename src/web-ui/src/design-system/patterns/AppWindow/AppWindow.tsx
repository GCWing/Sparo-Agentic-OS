import React, { forwardRef, useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from '../../primitives/IconButton';
import './AppWindow.scss';

export type AppWindowSize = 'large' | 'wide' | 'full';

export interface AppWindowProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  titleExtra?: React.ReactNode;
  children: React.ReactNode;
  size?: AppWindowSize;
  contentInset?: boolean;
  contentClassName?: string;
  className?: string;
  showCloseButton?: boolean;
  closeOnEscape?: boolean;
  restoreFocus?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
  closeLabel?: string;
  role?: 'dialog' | 'region';
}

export interface AppWindowHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  titleExtra?: React.ReactNode;
}

export type AppWindowBodyProps = React.HTMLAttributes<HTMLDivElement>;
export type AppWindowFooterProps = React.HTMLAttributes<HTMLDivElement>;

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function isAppWindowStructure(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) {
      return false;
    }

    const childType = child.type as { displayName?: string };
    return (
      childType.displayName === 'AppWindowHeader'
      || childType.displayName === 'AppWindowBody'
      || childType.displayName === 'AppWindowFooter'
    );
  });
}

export const AppWindowHeader = forwardRef<HTMLDivElement, AppWindowHeaderProps>(({
  title,
  titleExtra,
  className,
  children,
  ...props
}, ref) => (
  <div ref={ref} className={cx('ds-app-window__header', className)} {...props}>
    {(title || titleExtra) && (
      <div className="ds-app-window__title-group">
        {title && <h2 className="ds-app-window__title">{title}</h2>}
        {titleExtra && <span className="ds-app-window__title-extra">{titleExtra}</span>}
      </div>
    )}
    {children}
  </div>
));

AppWindowHeader.displayName = 'AppWindowHeader';

export const AppWindowBody = forwardRef<HTMLDivElement, AppWindowBodyProps>(({
  className,
  ...props
}, ref) => (
  <div ref={ref} className={cx('ds-app-window__body', className)} {...props} />
));

AppWindowBody.displayName = 'AppWindowBody';

export const AppWindowFooter = forwardRef<HTMLDivElement, AppWindowFooterProps>(({
  className,
  ...props
}, ref) => (
  <div ref={ref} className={cx('ds-app-window__footer', className)} {...props} />
));

AppWindowFooter.displayName = 'AppWindowFooter';

/**
 * Non-modal in-app window for substantial content and multi-section workflows.
 * It floats above the app without a backdrop and does not block background interaction.
 */
export function AppWindow({
  open,
  onOpenChange,
  title,
  titleExtra,
  children,
  size = 'wide',
  contentInset = false,
  contentClassName,
  className,
  showCloseButton = true,
  closeOnEscape = true,
  restoreFocus = true,
  initialFocusRef,
  labelledBy,
  describedBy,
  ariaLabel,
  closeLabel = 'Close application window',
  role = 'dialog',
}: AppWindowProps): React.ReactPortal | null {
  const windowRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const generatedTitleId = useId();
  const titleId = labelledBy ?? (title ? generatedTitleId : undefined);

  const closeWindow = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusFrame = window.requestAnimationFrame(() => {
      (initialFocusRef?.current ?? windowRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') {
        const activeModal = document.querySelector<HTMLElement>('[aria-modal="true"]');
        if (activeModal && !windowRef.current?.contains(activeModal)) {
          return;
        }
        event.preventDefault();
        closeWindow();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      if (restoreFocus) {
        previousFocusRef.current?.focus();
      }
    };
  }, [closeOnEscape, closeWindow, initialFocusRef, open, restoreFocus]);

  if (!open) {
    return null;
  }

  const hasStructuredChildren = isAppWindowStructure(children);

  return createPortal(
    <section
      ref={windowRef}
      className={cx(
        'ds-app-window',
        `ds-app-window--${size}`,
        showCloseButton && 'ds-app-window--with-close',
        className,
      )}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      tabIndex={-1}
    >
      {(title || titleExtra || showCloseButton) && (
        <div
          className={cx(
            'ds-app-window__header-shell',
            !title && showCloseButton && 'ds-app-window__header-shell--close-only',
          )}
        >
          {(title || titleExtra) && (
            <AppWindowHeader id={titleId} title={title} titleExtra={titleExtra} />
          )}
          {showCloseButton && (
            <IconButton
              className="ds-app-window__close"
              type="button"
              size="xs"
              shape="circle"
              variant="ghost"
              aria-label={closeLabel}
              onClick={closeWindow}
            >
              <X aria-hidden="true" size={14} strokeWidth={2} />
            </IconButton>
          )}
        </div>
      )}
      {hasStructuredChildren ? (
        children
      ) : (
        <AppWindowBody
          className={cx(contentInset && 'ds-app-window__body--inset', contentClassName)}
        >
          {children}
        </AppWindowBody>
      )}
    </section>,
    document.body,
  );
}
