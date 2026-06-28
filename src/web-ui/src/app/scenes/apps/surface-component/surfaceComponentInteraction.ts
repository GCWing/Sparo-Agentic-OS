import type {
  SurfaceComponent,
  SurfaceComponentInteraction,
  SurfaceComponentInteractionTab,
  SurfaceComponentInteractionText,
  SurfaceComponentMeta,
} from '@/infrastructure/api/service-api/SurfaceComponentAPI';
import type {
  SurfaceComponentWorkbenchPanelType,
  SurfaceComponentWorkbenchSessionMetadata,
  SurfaceComponentWorkbenchTabMetadata,
} from '@/shared/types/session-history';
import {
  normalizeAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import { resolveSurfaceComponentMeta } from './surfaceComponentI18n';

const DEFAULT_ENTITY_ID = 'default';

export type SurfaceComponentWorkbenchProfileId = 'surface-component-workbench';

export function isCompositeSurfaceComponent(app: Pick<SurfaceComponentMeta, 'interaction'>): boolean {
  return app.interaction?.mode === 'composite';
}

export function normalizeSurfaceComponentWorkbenchProfile(
  _interaction?: SurfaceComponentInteraction | null
): SurfaceComponentWorkbenchProfileId {
  return 'surface-component-workbench';
}

export function resolveInteractionText(
  text: SurfaceComponentInteractionText | undefined,
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

export function normalizeSurfaceComponentWorkbenchTabType(
  rawType: string | undefined
): SurfaceComponentWorkbenchPanelType | null {
  if (!rawType?.trim()) return null;

  switch (rawType) {
    case 'surfaceComponent':
    case 'surface-component':
    case 'surfaceComponentRunner':
    case 'surface-component-runner':
      return 'surface-component-runner';
    case 'surfaceComponentWorkbenchTab':
    case 'surface-component-workbench-tab':
    case 'backendRuns':
    case 'surfaceComponentDataView':
      return 'surface-component-workbench-tab';
    case 'surfaceComponentDiagnostics':
    case 'surface-component-diagnostics':
      return 'surface-component-diagnostics';
    default:
      return 'surface-component-workbench-tab';
  }
}

function defaultTabForApp(appName: string): SurfaceComponentWorkbenchTabMetadata {
  return {
    id: 'app',
    type: 'surface-component-runner',
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

function fallbackTitleForTab(type: SurfaceComponentWorkbenchPanelType, appName: string, route?: string): string {
  switch (type) {
    case 'surface-component-workbench-tab':
      return routeLabel(route) || appName;
    case 'surface-component-diagnostics':
      return 'Diagnostics';
    default:
      return appName;
  }
}

function normalizeInteractionTab(
  tab: SurfaceComponentInteractionTab,
  appName: string,
  locale?: string | null
): SurfaceComponentWorkbenchTabMetadata | null {
  const type = normalizeSurfaceComponentWorkbenchTabType(tab.type);
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

export function buildSurfaceComponentWorkbenchMetadata(
  app: SurfaceComponent | SurfaceComponentMeta,
  options: {
    entityId?: string | null;
    locale?: string | null;
    scope?: AppScope | null;
  } = {}
): SurfaceComponentWorkbenchSessionMetadata {
  const displayMeta = resolveSurfaceComponentMeta(app, options.locale || undefined);
  const profile = normalizeSurfaceComponentWorkbenchProfile(app.interaction);
  const scope = normalizeAppScope(options.scope);
  const declaredTabs = (app.interaction?.tabs || [])
    .map(tab => normalizeInteractionTab(tab, displayMeta.name, options.locale))
    .filter((tab): tab is SurfaceComponentWorkbenchTabMetadata => Boolean(tab));
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
