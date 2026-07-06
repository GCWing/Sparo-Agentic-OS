import type { AppIconSpec, NativeAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';

const NATIVE_ICON_BASE_PATH = '/native-app-icons';
const SPARO_OS_AUTHORS = [
  {
    name: 'Sparo OS',
    url: 'https://gcwing.github.io/Sparo-Agentic-OS/',
  },
];

function nativeSystemIcon(assetId: string, fileName: string): AppIconSpec {
  return {
    kind: 'nativeAsset',
    assetId,
    mimeType: 'image/png',
    uri: `${NATIVE_ICON_BASE_PATH}/${fileName}`,
  };
}

export const NATIVE_SYSTEM_APP_CATALOG: NativeAppCatalogEntry[] = [
  {
    id: 'runno',
    name: 'Runno',
    description: "Sparo OS's general execution unit: flexible, efficient, and strongly goal-oriented for handling all kinds of tasks.",
    authors: SPARO_OS_AUTHORS,
    i18n: {
      locales: {
        'en-US': {
          name: 'Runno',
          description: "Sparo OS's general execution unit: flexible, efficient, and strongly goal-oriented for handling all kinds of tasks.",
          tags: ['os', 'execution', 'general'],
        },
        'zh-CN': {
          name: 'Runno',
          description: 'Sparo OS 的通用执行单元，灵活、高效、目标感强，适合处理各种类型任务。',
          tags: ['系统', '执行', '通用'],
        },
      },
    },
    interactionModel: 'conversation',
    workMultiplicity: 'multiple',
    workObjectKinds: [],
    truthSource: null,
    primarySurfaceMode: 'chatPrimary',
    permissions: {
      fs: true,
      shell: true,
      ai: true,
    },
    icon: nativeSystemIcon('runno', 'runno-icon.png'),
    category: 'system',
    tags: ['os', 'execution', 'general'],
    launch: {
      kind: 'agentSession',
      targetId: 'Runno',
      scopeRequirement: 'workspaceOptional',
      agentType: 'Runno',
      surfaceId: null,
    },
    origin: 'nativeSystem',
    availability: 'alwaysAvailable',
    management: {
      origin: 'nativeSystem',
      actions: ['configure', 'resetState', 'hideFromHome'],
    },
  },
  {
    id: 'app-builder',
    name: 'App Builder',
    description: "Build a personal intelligent app around your way of working by understanding your needs or existing apps, then recomposing features, workflows, and methods.",
    authors: SPARO_OS_AUTHORS,
    i18n: {
      locales: {
        'en-US': {
          name: 'App Builder',
          description: "Build a personal intelligent app around your way of working by understanding your needs or existing apps, then recomposing features, workflows, and methods.",
          tags: ['app-builder', 'intelligent-app', 'reuse'],
        },
        'zh-CN': {
          name: 'App Builder',
          description: '为你打造专属智能应用，理解需求或解析既有应用，重组功能、流程与方法，让应用更贴合你的工作方式。',
          tags: ['应用构建', '智能应用', '复用'],
        },
      },
    },
    interactionModel: 'conversation',
    workMultiplicity: 'multiple',
    workObjectKinds: [],
    truthSource: null,
    primarySurfaceMode: 'chatPrimary',
    permissions: {
      fs: true,
      shell: true,
      ai: true,
    },
    icon: nativeSystemIcon('app-builder', 'app-builder-icon.png'),
    category: 'developer',
    tags: ['app-builder', 'intelligent-app', 'reuse'],
    launch: {
      kind: 'appBuilder',
      targetId: 'AppBuilder',
      scopeRequirement: 'systemAllowed',
      agentType: 'AppBuilder',
      surfaceId: null,
    },
    origin: 'nativeSystem',
    availability: 'alwaysAvailable',
    management: {
      origin: 'nativeSystem',
      actions: ['configure', 'resetState', 'hideFromHome'],
    },
  },
];

const NATIVE_SYSTEM_ICON_BY_APP_ID = new Map(
  NATIVE_SYSTEM_APP_CATALOG.map((app) => [app.id, app.icon]),
);

export function withShellNativeAppIcons(apps: NativeAppCatalogEntry[]): NativeAppCatalogEntry[] {
  return apps.map((app) => {
    const icon = NATIVE_SYSTEM_ICON_BY_APP_ID.get(app.id);
    return icon ? { ...app, icon } : app;
  });
}
