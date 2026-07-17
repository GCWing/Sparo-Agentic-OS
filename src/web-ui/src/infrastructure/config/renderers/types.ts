export type SettingChangeHandler<T> = (value: T) => void | Promise<unknown>;

export interface SettingRendererFieldProps<T> {
  id: string;
  label: string;
  description?: string;
  value: T;
  onChange: SettingChangeHandler<T>;
  disabled?: boolean;
  loading?: boolean;
  errorMessage?: string;
  onError?: (error: Error) => void;
}

export function dispatchSettingChange<T>(
  handler: SettingChangeHandler<T>,
  value: T,
  onError?: (error: Error) => void,
): void {
  try {
    void Promise.resolve(handler(value)).catch((error: unknown) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}
