 

import { ITransportAdapter } from './base';
import { TauriTransportAdapter } from './tauri-adapter';
export * from './base';
export * from './tauri-adapter';

 
export function detectEnvironment(): 'tauri' {
  
  return 'tauri';
}

 
export function createTransportAdapter(_forceEnv?: 'tauri'): ITransportAdapter {
  return new TauriTransportAdapter();
}

 
let globalAdapter: ITransportAdapter | null = null;

 
export function getTransportAdapter(): ITransportAdapter {
  if (!globalAdapter) {
    globalAdapter = createTransportAdapter();
  }
  return globalAdapter;
}

 
export async function resetTransportAdapter(): Promise<void> {
  if (globalAdapter) {
    await globalAdapter.disconnect();
    globalAdapter = null;
  }
}

 
export function setTransportAdapter(adapter: ITransportAdapter): void {
  globalAdapter = adapter;
}

