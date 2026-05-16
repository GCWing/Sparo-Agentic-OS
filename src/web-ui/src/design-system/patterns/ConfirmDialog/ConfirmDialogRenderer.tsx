import React, { useSyncExternalStore } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import {
  cancelCurrentDialog,
  closeCurrentDialog,
  confirmCurrentDialog,
  getConfirmDialogSnapshot,
  subscribeConfirmDialog,
} from './confirmService';

export const ConfirmDialogRenderer: React.FC = () => {
  const { open, options } = useSyncExternalStore(
    subscribeConfirmDialog,
    getConfirmDialogSnapshot,
    getConfirmDialogSnapshot
  );

  if (!options) {
    return null;
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeCurrentDialog();
        }
      }}
      onConfirm={confirmCurrentDialog}
      onCancel={cancelCurrentDialog}
      title={options.title}
      message={options.message}
      type={options.type}
      confirmText={options.confirmText}
      cancelText={options.cancelText}
      confirmDanger={options.confirmDanger}
      showCancel={options.showCancel}
      preview={options.preview}
      previewMaxHeight={options.previewMaxHeight}
    />
  );
};

export default ConfirmDialogRenderer;
