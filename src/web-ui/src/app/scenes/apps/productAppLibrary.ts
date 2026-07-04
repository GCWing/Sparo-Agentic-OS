import type {
  ProductAppCatalogEntry,
  ProductAppLibrary,
  ProductAppLibrarySource,
  ProductAppManagementPolicy,
} from '@/infrastructure/api/service-api/AppCatalogAPI';

const MANAGEMENT_ORIGIN_RANK: Record<NonNullable<ProductAppManagementPolicy['origin']>, number> = {
  installedPackage: 3,
  updateSource: 2,
  discoverableSource: 1,
  hidden: 0,
};

export function productAppLibraryKey(app: Pick<ProductAppCatalogEntry, 'id' | 'version'>): string {
  return `${app.id}@${app.version}`;
}

function mergeProductAppManagement(
  current: ProductAppManagementPolicy | null | undefined,
  next: ProductAppManagementPolicy | null | undefined,
): ProductAppManagementPolicy {
  const actions = [...new Set([
    ...(current?.actions ?? []),
    ...(next?.actions ?? []),
  ])];
  const origins = [current?.origin, next?.origin]
    .filter(Boolean) as Array<NonNullable<ProductAppManagementPolicy['origin']>>;
  const origin = origins.sort((left, right) => (
    MANAGEMENT_ORIGIN_RANK[right] - MANAGEMENT_ORIGIN_RANK[left]
  ))[0] ?? 'hidden';

  return {
    origin,
    actions,
    uninstall: current?.uninstall ?? next?.uninstall ?? null,
  };
}

function mergeProductAppCatalogIssues(
  current: ProductAppCatalogEntry | undefined,
  next: ProductAppCatalogEntry,
): ProductAppCatalogEntry['catalogIssues'] {
  const byKey = new Map<string, NonNullable<ProductAppCatalogEntry['catalogIssues']>[number]>();
  for (const issue of [
    ...(current?.catalogIssues ?? []),
    ...(next.catalogIssues ?? []),
  ]) {
    byKey.set([
      issue.source,
      issue.appId ?? '',
      issue.appVersion ?? '',
      issue.packageDir,
      issue.message,
    ].join('\u001f'), issue);
  }
  return [...byKey.values()];
}

function mergeProductAppCatalogEntry(
  current: ProductAppCatalogEntry | undefined,
  next: ProductAppCatalogEntry,
  nextSources: Set<ProductAppLibrarySource>,
): ProductAppCatalogEntry {
  const installed = nextSources.has('installed');
  const updateAvailable = current?.updateAvailable === true || next.updateAvailable === true;
  const base = current?.installed === true ? current : next;
  const installedEntry = current?.installed === true
    ? current
    : next.installed === true
      ? next
      : null;
  const sourceEntry = next.catalogSource?.kind !== 'installedPackage'
    ? next
    : current?.catalogSource?.kind !== 'installedPackage'
      ? current
      : null;

  return {
    ...base,
    catalogSource: installed
      ? installedEntry?.catalogSource ?? base.catalogSource ?? sourceEntry?.catalogSource
      : sourceEntry?.catalogSource ?? base.catalogSource,
    updateAvailable,
    management: mergeProductAppManagement(current?.management, next.management),
    installedComponentLockDigest:
      current?.installedComponentLockDigest
      ?? next.installedComponentLockDigest
      ?? installedEntry?.componentLockDigest,
    availableComponentLockDigest:
      next.availableComponentLockDigest
      ?? current?.availableComponentLockDigest
      ?? sourceEntry?.componentLockDigest,
    installedPackageDigest:
      current?.installedPackageDigest
      ?? next.installedPackageDigest
      ?? installedEntry?.packageDigest,
    availablePackageDigest:
      next.availablePackageDigest
      ?? current?.availablePackageDigest
      ?? sourceEntry?.packageDigest,
    catalogReleaseId: next.catalogReleaseId ?? current?.catalogReleaseId,
    catalogReleaseLabel: next.catalogReleaseLabel ?? current?.catalogReleaseLabel,
    catalogReleaseNotes: next.catalogReleaseNotes ?? current?.catalogReleaseNotes,
    catalogPublishedAtMs: next.catalogPublishedAtMs ?? current?.catalogPublishedAtMs,
    catalogIssues: mergeProductAppCatalogIssues(current, next),
    installed,
    discoverable: !installed && nextSources.has('discoverable') && !updateAvailable,
    librarySources: [...nextSources],
  };
}

export function mergeProductAppLibrary(library: ProductAppLibrary): ProductAppCatalogEntry[] {
  const byKey = new Map<string, ProductAppCatalogEntry>();

  const addSource = (
    app: ProductAppCatalogEntry,
    source: ProductAppLibrarySource,
  ) => {
    const key = productAppLibraryKey(app);
    const current = byKey.get(key);
    const nextSources = new Set(current?.librarySources ?? []);
    nextSources.add(source);
    byKey.set(key, mergeProductAppCatalogEntry(current, app, nextSources));
  };

  for (const app of library.installed) addSource(app, 'installed');
  for (const app of library.discoverable) addSource(app, 'discoverable');
  return [...byKey.values()];
}
