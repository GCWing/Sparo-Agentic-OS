import type {
  ProductAppHostSurface,
  ProductAppHostSurfaceInteraction,
  ProductAppHostSurfaceInteractionChat,
  ProductAppHostSurfaceInteractionTab,
  ProductAppHostSurfaceInteractionText,
  ProductAppHostSurfaceMeta,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import type {
  ProductAppRuntimePanelType,
  ProductAppRuntimeSessionMetadata,
  ProductAppRuntimeSidecarIcon,
  ProductAppRuntimeTabSidecarMetadata,
  ProductAppRuntimeTabMetadata,
} from '@/shared/types/session-history';
import {
  normalizeAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import { resolveProductAppHostSurfaceMeta } from './productAppRuntimeHostMeta';

const DEFAULT_ENTITY_ID = 'default';
const SIDECAR_ICONS = new Set<ProductAppRuntimeSidecarIcon>([
  'activity',
  'app-window',
  'file-text',
  'palette',
  'play',
  'settings',
]);

export type ProductAppRuntimeProfileId = 'product-app-runtime';

export function isCompositeProductAppRuntimeHost(app: Pick<ProductAppHostSurfaceMeta, 'interaction'>): boolean {
  return app.interaction?.mode === 'composite';
}

export function normalizeProductAppRuntimeProfile(
  _interaction?: ProductAppHostSurfaceInteraction | null
): ProductAppRuntimeProfileId {
  return 'product-app-runtime';
}

export function resolveInteractionText(
  text: ProductAppHostSurfaceInteractionText | undefined,
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

export function normalizeProductAppRuntimeTabType(
  rawType: string | undefined
): ProductAppRuntimePanelType | null {
  const type = rawType?.trim();
  if (!type) return null;
  return type === 'product-app-runtime' ? 'product-app-runtime' : null;
}

function defaultTabForApp(appName: string): ProductAppRuntimeTabMetadata {
  return {
    id: 'app',
    type: 'product-app-runtime',
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

function fallbackTitleForTab(_type: ProductAppRuntimePanelType, appName: string, route?: string): string {
  return routeLabel(route) || appName;
}

function normalizeInteractionTabSidecar(
  sidecar: ProductAppHostSurfaceInteractionTab['sidecar']
): ProductAppRuntimeTabSidecarMetadata | undefined {
  if (!sidecar || typeof sidecar !== 'object') return undefined;
  const actionId = typeof sidecar.actionId === 'string'
    ? sidecar.actionId.trim() || undefined
    : undefined;
  const icon = typeof sidecar.icon === 'string' && SIDECAR_ICONS.has(sidecar.icon as ProductAppRuntimeSidecarIcon)
    ? sidecar.icon as ProductAppRuntimeSidecarIcon
    : undefined;
  const order = typeof sidecar.order === 'number' && Number.isFinite(sidecar.order)
    ? sidecar.order
    : undefined;
  const availability = sidecar.availability === 'enabled' ||
    sidecar.availability === 'disabled' ||
    sidecar.availability === 'hidden'
    ? sidecar.availability
    : undefined;
  const targetGroup = sidecar.targetGroup === 'primary' || sidecar.targetGroup === 'secondary'
    ? sidecar.targetGroup
    : undefined;

  if (!actionId && !icon && order === undefined && !availability && !targetGroup) {
    return undefined;
  }
  return { actionId, icon, order, availability, targetGroup };
}

function resolveRuntimeChatMetadata(
  app: ProductAppHostSurface | ProductAppHostSurfaceMeta
): ProductAppHostSurfaceInteractionChat | undefined {
  const chat = app.interaction?.chat;
  if (!chat) return undefined;

  const backendId = chat.backendId?.trim();
  const declaredAgentComponentId = chat.agentComponentId?.trim();
  const agentType = chat.agentType?.trim();
  const backendAgentType = chat.backendAgentType?.trim();
  const backend = backendId
    ? app.backends?.find((candidate) => candidate.id === backendId)
    : undefined;
  const derivedAgentComponentId = backend?.kind === 'agentComponent'
    ? backend.componentId.trim()
    : undefined;

  return {
    ...chat,
    backendId: backendId || chat.backendId,
    agentComponentId: declaredAgentComponentId || derivedAgentComponentId || chat.agentComponentId,
    agentType: agentType || undefined,
    backendAgentType: backendAgentType || agentType || undefined,
  };
}

function normalizeInteractionTab(
  tab: ProductAppHostSurfaceInteractionTab,
  appName: string,
  locale?: string | null
): ProductAppRuntimeTabMetadata | null {
  const type = normalizeProductAppRuntimeTabType(tab.type);
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
    sidecar: normalizeInteractionTabSidecar(tab.sidecar),
    data: tab.data,
  };
}

export function buildProductAppRuntimeMetadata(
  app: ProductAppHostSurface | ProductAppHostSurfaceMeta,
  options: {
    intelligentApp: {
      appId: string;
      displayName: string;
      releaseId: string;
      workMultiplicity: ProductAppRuntimeSessionMetadata['workMultiplicity'];
    };
    entityId?: string | null;
    locale?: string | null;
    scope?: AppScope | null;
    runtimeContext?: ProductAppRuntimeContext | null;
  }
): ProductAppRuntimeSessionMetadata {
  const displayMeta = resolveProductAppHostSurfaceMeta(app, options.locale || undefined);
  const intelligentApp = options.intelligentApp;
  const profile = normalizeProductAppRuntimeProfile(app.interaction);
  const scope = normalizeAppScope(options.scope);
  const declaredTabs = (app.interaction?.tabs || [])
    .map(tab => normalizeInteractionTab(tab, displayMeta.name, options.locale))
    .filter((tab): tab is ProductAppRuntimeTabMetadata => Boolean(tab));
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
    appId: intelligentApp.appId,
    appName: intelligentApp.displayName || displayMeta.name,
    hostSurfaceId: app.id,
    hostSurfaceName: displayMeta.name,
    entityId: options.entityId?.trim() || DEFAULT_ENTITY_ID,
    profile,
    slotId: options.runtimeContext?.slotId ?? null,
    releaseId: intelligentApp.releaseId,
    configRevision: options.runtimeContext?.configRevision ?? null,
    sourceRevision: app.runtime?.source_revision,
    interactionTitle: resolveInteractionText(app.interaction?.title, options.locale),
    workMultiplicity: intelligentApp.workMultiplicity,
    scope,
    workspacePath: workspacePathFromAppScope(scope) ?? null,
    runtimeContext: options.runtimeContext ?? null,
    chat: resolveRuntimeChatMetadata(app),
    agentWorkspace: app.interaction?.agentWorkspace,
    tabs,
    flowChatCards: app.interaction?.flowChatCards?.map(card => ({
      id: card.id,
      description: card.description,
      ui: card.ui,
    })),
  };
}
