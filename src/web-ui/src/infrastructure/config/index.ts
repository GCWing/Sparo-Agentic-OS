/**
 * Configuration infrastructure unified exports.
 */

// Core config logic
export * from './core';

// Types
export * from './types';

// Services
export * from './services/ConfigManager';
export * from './services/modelConfigs';
export * from './customSettingsProjection';

// Components
export { default as AIModelConfig } from './components/AIModelConfig';

// Default instance
export { configManager } from './services/ConfigManager';

// Authoritative catalog, revisioned snapshot, and transaction clients
export * from './catalog';
export * from './snapshot';
export * from './transaction';
export * from './hooks';
export * from './renderers';
export * from './startup';

// Re-export common types
export type {
  ModelConfig,
  ProviderTemplate,
  ApiFormat
} from '../../shared/types';

// Configuration infrastructure lifecycle
import { configCatalogStore } from './catalog';
import { configSnapshotStore } from './snapshot';
import { configStartupStatusStore } from './startup';
import { globalEventBus } from '../event-bus';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ConfigInfrastructure');

export async function initializeConfigInfrastructure(): Promise<void> {
  log.info('Initializing configuration infrastructure');
  
  try {
    // Startup mode is authoritative for every settings projection and write
    // client, so resolve it before starting snapshot/catalog consumers.
    await configStartupStatusStore.load();
    await Promise.all([
      configCatalogStore.load(),
      configSnapshotStore.start(),
    ]);
    
    globalEventBus.emit('infrastructure:config:ready');
    log.info('Configuration infrastructure initialized');
  } catch (error) {
    log.error('Failed to initialize configuration infrastructure', error);
    throw error;
  }
}

// Configuration infrastructure metadata
export const ConfigInfrastructureMetadata = {
  name: 'Config Infrastructure',
  version: '1.0.0',
  description: 'Application configuration management infrastructure',
  dependencies: ['event-bus'],
  capabilities: [
    'configuration-management',
    'theme-switching',
    'ai-model-configuration',
    'editor-settings'
  ]
} as const;
