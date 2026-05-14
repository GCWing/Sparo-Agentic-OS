export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}
