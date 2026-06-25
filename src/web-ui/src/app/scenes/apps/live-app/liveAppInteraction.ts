import type {
  LiveApp,
  LiveAppInteraction,
  LiveAppInteractionTab,
  LiveAppInteractionText,
  LiveAppMeta,
} from '@/infrastructure/api/service-api/LiveAppAPI';
import type {
  LiveAppWorkbenchPanelType,
  LiveAppWorkbenchSessionMetadata,
  LiveAppWorkbenchTabMetadata,
} from '@/shared/types/session-history';
import {
  normalizeAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { resolveLiveAppMeta } from './liveAppI18n';

const DEFAULT_ENTITY_ID = 'default';

export type LiveAppWorkbenchProfileId = 'live-app-workbench';

export function isCompositeLiveApp(app: Pick<LiveAppMeta, 'interaction'>): boolean {
  return app.interaction?.mode === 'composite';
}

export function normalizeLiveAppWorkbenchProfile(
  _interaction?: LiveAppInteraction | null
): LiveAppWorkbenchProfileId {
  return 'live-app-workbench';
}

export function resolveInteractionText(
  text: LiveAppInteractionText | undefined,
  locale?: string | null
): string | undefined {
  if (!text) return undefined;
  if (typeof text === 'string') return text.trim() || undefined;
  const normalizedLocale = locale?.trim();
  if (normalizedLocale && typeof text[normalizedLocale] === 'string') {
    return text[normalizedLocale].trim() || undefined;
  }
  const languageOnly = normalizedLocale?.split('-')[0];
  if (languageOnly && typeof text[languageOnly] === 'string') {
    return text[languageOnly].trim() || undefined;
  }
  return Object.values(text).find((value) => typeof value === 'string' && value.trim())?.trim();
}

export function normalizeLiveAppWorkbenchTabType(
  rawType: string | undefined
): LiveAppWorkbenchPanelType | null {
  if (!rawType?.trim()) return null;

  switch (rawType) {
    case 'liveApp':
    case 'live-app':
    case 'liveAppRunner':
    case 'live-app-runner':
      return 'live-app-runner';
    case 'liveAppWorkbenchTab':
    case 'live-app-workbench-tab':
    case 'backendRuns':
    case 'liveAppDataView':
      return 'live-app-workbench-tab';
    case 'liveAppDiagnostics':
    case 'live-app-diagnostics':
      return 'live-app-diagnostics';
    default:
      return 'live-app-workbench-tab';
  }
}

function defaultTabForApp(appName: string): LiveAppWorkbenchTabMetadata {
  return {
    id: 'app',
    type: 'live-app-runner',
    title: appName,
    route: '/',
    default: true,
  };
}

function routeLabel(route?: string): string | null {
  const trimmed = route?.trim();
  if (!trimmed || trimmed === '/') return null;
  const lastSegment = trimmed.split('/').filter(Boolean).pop();
  if (!lastSegment) return null;
  return lastSegment
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function fallbackTitleForTab(type: LiveAppWorkbenchPanelType, appName: string, route?: string): string {
  switch (type) {
    case 'live-app-workbench-tab':
      return routeLabel(route) || appName;
    case 'live-app-diagnostics':
      return 'Diagnostics';
    default:
      return appName;
  }
}

function normalizeInteractionTab(
  tab: LiveAppInteractionTab,
  appName: string,
  locale?: string | null
): LiveAppWorkbenchTabMetadata | null {
  const type = normalizeLiveAppWorkbenchTabType(tab.type);
  if (!type) return null;
  const route =
    typeof tab.route === 'string'
      ? tab.route.trim() || undefined
      : typeof tab.data?.route === 'string'
        ? tab.data.route.trim() || undefined
        : undefined;
  const title =
    resolveInteractionText(tab.title, locale) ||
    tab.titleKey ||
    fallbackTitleForTab(type, appName, route);
  return {
    id: tab.id.trim() || type,
    type,
    title,
    route,
    default: tab.default === true,
    developerOnly: tab.developerOnly === true,
    data: tab.data,
  };
}

export function buildLiveAppWorkbenchMetadata(
  app: LiveApp | LiveAppMeta,
  options: {
    entityId?: string | null;
    locale?: string | null;
    scope?: AppScope | null;
  } = {}
): LiveAppWorkbenchSessionMetadata {
  const displayMeta = resolveLiveAppMeta(app, options.locale || undefined);
  const profile = normalizeLiveAppWorkbenchProfile(app.interaction);
  const scope = normalizeAppScope(options.scope);
  const declaredTabs = (app.interaction?.tabs || [])
    .map(tab => normalizeInteractionTab(tab, displayMeta.name, options.locale))
    .filter((tab): tab is LiveAppWorkbenchTabMetadata => Boolean(tab));
  const tabs = declaredTabs.length > 0
    ? declaredTabs
    : [defaultTabForApp(displayMeta.name)];

  if (!tabs.some(tab => tab.default && !tab.developerOnly)) {
    const firstVisible = tabs.find(tab => !tab.developerOnly);
    if (firstVisible) {
      firstVisible.default = true;
    }
  }

  return {
    appId: app.id,
    appName: displayMeta.name,
    entityId: options.entityId?.trim() || DEFAULT_ENTITY_ID,
    profile,
    version: app.version,
    sourceRevision: app.runtime?.source_revision,
    interactionTitle: resolveInteractionText(app.interaction?.title, options.locale),
    scope,
    workspacePath: workspacePathFromAppScope(scope) ?? null,
    chat: app.interaction?.chat as Record<string, unknown> | undefined,
    tabs,
  };
}
