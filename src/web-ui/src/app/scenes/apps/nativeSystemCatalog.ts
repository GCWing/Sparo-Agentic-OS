import type { AppIconSpec, NativeAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';

const NATIVE_ICON_BASE_PATH = '/native-app-icons';

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
    id: 'prime-builder',
    name: 'BitFun Coder',
    description: 'Native default execution workspace for flexible implementation, debugging, automation, and verification.',
    goal: 'Take a goal, choose the next action, execute, verify, and hand off the result.',
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
    icon: nativeSystemIcon('prime-builder', 'prime-builder-icon.png'),
    category: 'developer',
    tags: ['native', 'coding', 'development'],
    launch: {
      kind: 'agentSession',
      targetId: 'agentic',
      scopeRequirement: 'workspaceOptional',
      agentType: 'agentic',
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
    id: 'cowork',
    name: 'Cowork',
    description: 'Native collaboration workspace for documents, drafting, and structured multi-step work.',
    goal: 'Clarify, plan, draft, revise, and package collaborative work with practical artifacts.',
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
    icon: nativeSystemIcon('cowork', 'cowork-icon.png'),
    category: 'productivity',
    tags: ['native', 'documents', 'collaboration'],
    launch: {
      kind: 'agentSession',
      targetId: 'Cowork',
      scopeRequirement: 'workspaceOptional',
      agentType: 'Cowork',
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
    id: 'design',
    name: 'Design',
    description: 'Native design workspace for artifacts, prototypes, and visual systems.',
    goal: 'Create and refine design artifacts, prototypes, and visual systems from a user brief.',
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
    icon: nativeSystemIcon('design', 'design-icon.png'),
    category: 'creative',
    tags: ['native', 'design', 'prototype'],
    launch: {
      kind: 'agentSession',
      targetId: 'Design',
      scopeRequirement: 'workspaceOptional',
      agentType: 'Design',
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
    id: 'app-studio',
    name: 'App Studio',
    description: 'Native Product App creation and maintenance studio for package-first app design.',
    goal: 'Create, inspect, and evolve Product App packages and their component graph.',
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
    icon: nativeSystemIcon('app-studio', 'app-studio-icon.png'),
    category: 'developer',
    tags: ['native', 'studio', 'product-app'],
    launch: {
      kind: 'appStudio',
      targetId: 'AppStudio',
      scopeRequirement: 'systemAllowed',
      agentType: 'AppStudio',
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
