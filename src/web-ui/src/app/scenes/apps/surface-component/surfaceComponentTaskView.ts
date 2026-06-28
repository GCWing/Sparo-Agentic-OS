import { useMemo } from 'react';
import { useSurfaceComponentStore } from './surfaceComponentStore';
import { useI18n } from '@/infrastructure/i18n';
import { resolveSurfaceComponentMeta } from './surfaceComponentI18n';

export interface RunningSurfaceComponentItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  updatedAt: number;
  overlayId: `app-surface:${string}`;
  isRunning: true;
}

function normalizeDescription(description: string, tags: string[]): string {
  const trimmed = description.trim();
  if (trimmed) return trimmed;
  return tags.join(' · ');
}

export function buildRunningSurfaceComponentItems(params: {
  apps: ReturnType<typeof useSurfaceComponentStore.getState>['apps'];
  runningAppIds: string[];
  locale?: string;
}): RunningSurfaceComponentItem[] {
  const { apps, runningAppIds, locale } = params;
  if (runningAppIds.length === 0 || apps.length === 0) return [];

  const appMap = new Map(apps.map(app => [app.id, app]));
  return runningAppIds
    .map(id => appMap.get(id))
    .filter((app): app is NonNullable<typeof app> => Boolean(app))
    .map(app => {
      const displayMeta = resolveSurfaceComponentMeta(app, locale);
      return {
        id: app.id,
        title: displayMeta.name,
        description: normalizeDescription(displayMeta.description, displayMeta.tags),
        icon: app.icon || 'surface-component',
        updatedAt: app.updated_at,
        overlayId: `app-surface:${app.id}` as const,
        isRunning: true as const,
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function useRunningSurfaceComponentItems(): RunningSurfaceComponentItem[] {
  const apps = useSurfaceComponentStore(state => state.apps);
  const runningAppIds = useSurfaceComponentStore(state => state.runningAppIds);
  const { currentLanguage } = useI18n();

  return useMemo(
    () => buildRunningSurfaceComponentItems({ apps, runningAppIds, locale: currentLanguage }),
    [apps, currentLanguage, runningAppIds]
  );
}

export function resolveActiveRunningSurfaceComponentId(activeSceneId: string | null): string | null {
  if (!activeSceneId?.startsWith('app-surface:')) return null;
  return activeSceneId.slice('app-surface:'.length) || null;
}
