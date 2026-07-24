import { useEffect, useSyncExternalStore } from 'react';
import { AppIcon, type AppIconSource } from '@/app/components/AppIcon';
import { NATIVE_SYSTEM_APP_CATALOG } from '@/app/scenes/apps/nativeSystemCatalog';
import {
  appCatalogAPI,
  subscribeAppCatalogChanges,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { createLogger } from '@/shared/utils/logger';
import type { WorkAppRef } from '../domain/workTypes';
import {
  getPrimaryWorkAppRef,
  type WorkAppIdentitySource,
  workUsesOwnAppIcon,
} from '../domain/workAppIdentity';
import { getWorkTypeIcon } from './workTypeIcon';

const log = createLogger('WorkIcon');

type Listener = () => void;

const nativeAppIconById = new Map<string, AppIconSource>(
  NATIVE_SYSTEM_APP_CATALOG.map((app) => [app.id, app]),
);
let productAppIconById = new Map<string, AppIconSource>();
let catalogLoaded = false;
let catalogLoad: Promise<void> | null = null;
let catalogRevision = 0;
const listeners = new Set<Listener>();

function emitCatalogChange(): void {
  catalogRevision += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): number {
  return catalogRevision;
}

function ensureProductAppIconCatalog(): Promise<void> {
  if (catalogLoaded) return Promise.resolve();
  if (catalogLoad) return catalogLoad;

  catalogLoad = appCatalogAPI.listProductAppLibrary()
    .then((library) => {
      const next = new Map<string, AppIconSource>();
      for (const app of [...library.discoverable, ...library.installed]) {
        next.set(app.appId, app);
      }
      productAppIconById = next;
      catalogLoaded = true;
      emitCatalogChange();
    })
    .catch((error) => {
      log.warn('Failed to load App icons for Work presentation', { error });
    })
    .finally(() => {
      catalogLoad = null;
    });
  return catalogLoad;
}

function iconSourceFor(appRef: WorkAppRef | undefined): AppIconSource | undefined {
  if (!appRef) return undefined;
  return appRef.kind === 'native_app'
    ? nativeAppIconById.get(appRef.appId)
    : productAppIconById.get(appRef.appId);
}

subscribeAppCatalogChanges(() => {
  productAppIconById = new Map();
  catalogLoaded = false;
  emitCatalogChange();
  if (listeners.size > 0) void ensureProductAppIconCatalog();
});

export interface WorkIconProps {
  work: WorkAppIdentitySource & { systemManaged?: boolean };
  size?: number;
  color?: string;
  className?: string;
  decorative?: boolean;
}

/** Shared Work icon contract: App-owned Work uses its App logo, otherwise its Work-type glyph. */
export function WorkIcon({
  work,
  size = 18,
  color,
  className,
  decorative = true,
}: WorkIconProps) {
  const appRef = workUsesOwnAppIcon(work) ? getPrimaryWorkAppRef(work) : undefined;
  useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (appRef?.kind === 'product_app') void ensureProductAppIconCatalog();
  }, [appRef?.appId, appRef?.kind]);

  const app = iconSourceFor(appRef);
  if (app) {
    return <AppIcon app={app} size={size} className={className} decorative={decorative} />;
  }

  const FallbackIcon = getWorkTypeIcon(work);
  return (
    <FallbackIcon
      size={size}
      color={color}
      className={className}
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : 'img'}
    />
  );
}

export default WorkIcon;
