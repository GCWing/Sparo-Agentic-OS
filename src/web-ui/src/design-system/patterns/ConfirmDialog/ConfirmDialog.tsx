import React, { useEffect, useId, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../primitives/Button/Button';
import { Dialog } from '../../primitives/Dialog/Dialog';
import './ConfirmDialog.scss';

export type ConfirmDialogType = 'info' | 'warning' | 'error' | 'success';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel?: () => void;
  title: string;
  message: React.ReactNode;
  type?: ConfirmDialogType;
  confirmText?: string;
  cancelText?: string;
  confirmDanger?: boolean;
  showCancel?: boolean;
  preview?: string;
  previewMaxHeight?: number;
}

const iconMap: Record<ConfirmDialogType, React.ReactNode> = {
  info: <Info size={22} />,
  warning: <AlertTriangle size={22} />,
  error: <AlertCircle size={22} />,
  success: <CheckCircle size={22} />,
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  title,
  message,
  type = 'warning',
  confirmText,
  cancelText,
  confirmDanger = false,
  showCancel = true,
  preview,
  previewMaxHeight = 200,
}) => {
  const { t } = useTranslation('common');
  const titleId = useId();
  const hasMessage = message !== null && message !== undefined && message !== '';
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const resolvedConfirmText = confirmText ?? t('actions.ok');
  const resolvedCancelText = cancelText ?? t('actions.cancel');

  useEffect(() => {
    if (open) {
      window.setTimeout(() => {
        confirmButtonRef.current?.focus();
      }, 100);
    }
  }, [open]);

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel();
        }
      }}
      size="small"
      showCloseButton={false}
      role="alertdialog"
      labelledBy={titleId}
    >
      <div className={`confirm-dialog confirm-dialog--${type}`}>
        <div className="confirm-dialog__icon" aria-hidden>
          {iconMap[type]}
        </div>

        <div className="confirm-dialog__content">
          <h3
            className={`confirm-dialog__title${hasMessage ? '' : ' confirm-dialog__title--compact'}`}
            id={titleId}
          >
            {title}
          </h3>
          {hasMessage ? (
            <div className="confirm-dialog__message" role="region" aria-labelledby={titleId}>
              {message}
            </div>
          ) : null}

          {preview && (
            <div className="confirm-dialog__preview" style={{ maxHeight: previewMaxHeight }}>
              <pre>{preview}</pre>
            </div>
          )}
        </div>

        <div className="confirm-dialog__actions">
          {showCancel && (
            <Button variant="secondary" size="small" onClick={handleCancel}>
              {resolvedCancelText}
            </Button>
          )}
          <Button
            ref={confirmButtonRef}
            variant={confirmDanger ? 'danger' : 'primary'}
            size="small"
            onClick={handleConfirm}
          >
            {resolvedConfirmText}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default ConfirmDialog;
