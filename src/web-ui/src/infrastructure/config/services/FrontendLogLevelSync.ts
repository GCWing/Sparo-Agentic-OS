import { configAPI } from '@/infrastructure/api';
import { LogLevel, createLogger, logger } from '@/shared/utils/logger';
import type { BackendLogLevel } from '../types';
import { configManager } from './ConfigManager';

const log = createLogger('FrontendLogLevelSync');
const LOGGING_LEVEL_SETTING_ID = 'core.app.logging.level';

let initialized = false;

function toFrontendLogLevel(level: string | null | undefined): LogLevel | null {
  switch (level?.trim().toLowerCase()) {
    case 'trace':
      return LogLevel.TRACE;
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    case 'off':
      return LogLevel.NONE;
    default:
      return null;
  }
}

function toBackendLogLevel(level: LogLevel): BackendLogLevel {
  switch (level) {
    case LogLevel.TRACE:
      return 'trace';
    case LogLevel.DEBUG:
      return 'debug';
    case LogLevel.INFO:
      return 'info';
    case LogLevel.WARN:
      return 'warn';
    case LogLevel.ERROR:
      return 'error';
    case LogLevel.NONE:
      return 'off';
  }
}

function applyFrontendLogLevel(level: string | null | undefined, source: string): void {
  const nextLevel = toFrontendLogLevel(level);
  if (nextLevel === null) {
    if (level) {
      log.warn('Ignoring invalid frontend log level', { level, source });
    }
    return;
  }

  const previousLevel = logger.getLevel();
  if (previousLevel === nextLevel) {
    return;
  }

  logger.setLevel(nextLevel);
  log.info('Frontend log level updated', {
    oldLevel: toBackendLogLevel(previousLevel),
    newLevel: toBackendLogLevel(nextLevel),
    source,
  });
}

async function resolveInitialLogLevel(): Promise<string | undefined> {
  const [savedLevelResult, runtimeInfoResult] = await Promise.allSettled([
    configManager.getSetting<BackendLogLevel>(LOGGING_LEVEL_SETTING_ID),
    configAPI.getRuntimeLoggingInfo(),
  ]);

  if (savedLevelResult.status === 'fulfilled' && toFrontendLogLevel(savedLevelResult.value) !== null) {
    return savedLevelResult.value;
  }

  if (runtimeInfoResult.status === 'fulfilled') {
    const runtimeLevel = runtimeInfoResult.value?.effectiveLevel;
    if (toFrontendLogLevel(runtimeLevel) !== null) {
      return runtimeLevel;
    }
  }

  return undefined;
}

export async function initializeFrontendLogLevelSync(): Promise<void> {
  if (initialized) {
    return;
  }

  initialized = true;

  configManager.onSettingChange((settingId, _oldValue, newValue) => {
    if (settingId !== LOGGING_LEVEL_SETTING_ID) {
      return;
    }

    applyFrontendLogLevel(typeof newValue === 'string' ? newValue : undefined, 'config_change');
  });

  try {
    const initialLevel = await resolveInitialLogLevel();
    applyFrontendLogLevel(initialLevel, 'startup');
  } catch (error) {
    log.error('Failed to initialize frontend log level sync', error);
  }
}
