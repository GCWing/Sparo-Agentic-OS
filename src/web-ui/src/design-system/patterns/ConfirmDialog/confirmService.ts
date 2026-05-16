import type { ReactNode } from 'react';
import type { ConfirmDialogType } from './ConfirmDialog';

export interface ConfirmDialogOptions {
  title: string;
  message: ReactNode;
  type?: ConfirmDialogType;
  confirmText?: string;
  cancelText?: string;
  confirmDanger?: boolean;
  showCancel?: boolean;
  preview?: string;
  previewMaxHeight?: number;
}

export interface ConfirmDialogSnapshot {
  open: boolean;
  options: ConfirmDialogOptions | null;
}

interface ConfirmDialogState extends ConfirmDialogSnapshot {
  resolve: ((value: boolean) => void) | null;
}

const listeners = new Set<() => void>();

let state: ConfirmDialogState = {
  open: false,
  options: null,
  resolve: null,
};

let snapshot: ConfirmDialogSnapshot = {
  open: state.open,
  options: state.options,
};

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(nextState: ConfirmDialogState) {
  state = nextState;
  snapshot = {
    open: state.open,
    options: state.options,
  };
  emit();
}

function settle(value: boolean) {
  state.resolve?.(value);
  setState({
    open: false,
    options: null,
    resolve: null,
  });
}

export function subscribeConfirmDialog(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConfirmDialogSnapshot(): ConfirmDialogSnapshot {
  return snapshot;
}

export function confirmCurrentDialog() {
  settle(true);
}

export function cancelCurrentDialog() {
  settle(false);
}

export function closeCurrentDialog() {
  settle(false);
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  state.resolve?.(false);

  return new Promise<boolean>((resolve) => {
    setState({
      open: true,
      options,
      resolve,
    });
  });
}

export function confirmWarning(
  title: string,
  message: ReactNode,
  options?: Partial<ConfirmDialogOptions>
): Promise<boolean> {
  return confirmDialog({
    title,
    message,
    type: 'warning',
    ...options,
  });
}

export function confirmDanger(
  title: string,
  message: ReactNode,
  options?: Partial<ConfirmDialogOptions>
): Promise<boolean> {
  return confirmDialog({
    title,
    message,
    type: 'error',
    confirmDanger: true,
    ...options,
  });
}

export function confirmInfo(
  title: string,
  message: ReactNode,
  options?: Partial<ConfirmDialogOptions>
): Promise<boolean> {
  return confirmDialog({
    title,
    message,
    type: 'info',
    showCancel: false,
    ...options,
  });
}
