import { useMemo } from 'react';
import { useLiveAppStore } from './liveAppStore';

export interface RunningLiveAppItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  updatedAt: number;
  overlayId: `live-app:${string}`;
  isRunning: true;
}

function normalizeDescription(description: string, tags: string[]): string {
  const trimmed = description.trim();
  if (trimmed) return trimmed;
  return tags.join(' · ');
}

export function buildRunningLiveAppItems(params: {
  apps: ReturnType<typeof useLiveAppStore.getState>['apps'];
  runningAppIds: string[];
}): RunningLiveAppItem[] {
  const { apps, runningAppIds } = params;
  if (runningAppIds.length === 0 || apps.length === 0) return [];

  const appMap = new Map(apps.map(app => [app.id, app]));
  return runningAppIds
    .map(id => appMap.get(id))
    .filter((app): app is NonNullable<typeof app> => Boolean(app))
    .map(app => ({
      id: app.id,
      title: app.name,
      description: normalizeDescription(app.description, app.tags),
      icon: app.icon || 'live-app',
      updatedAt: app.updated_at,
      overlayId: `live-app:${app.id}` as const,
      isRunning: true as const,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function useRunningLiveAppItems(): RunningLiveAppItem[] {
  const apps = useLiveAppStore(state => state.apps);
  const runningAppIds = useLiveAppStore(state => state.runningAppIds);

  return useMemo(
    () => buildRunningLiveAppItems({ apps, runningAppIds }),
    [apps, runningAppIds]
  );
}

export function resolveActiveRunningLiveAppId(activeSceneId: string | null): string | null {
  if (!activeSceneId?.startsWith('live-app:')) return null;
  return activeSceneId.slice('live-app:'.length) || null;
}
