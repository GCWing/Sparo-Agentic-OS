import { Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Alert, LoadingSkeleton } from '@/design-system';
import { useTranslation } from 'react-i18next';
import {
  configCatalogStore,
  configSnapshotStore,
  type SettingsSectionRef,
} from '@/infrastructure/config';
import {
  diffCustomSettingsDirtyIds,
  normalizeCustomSettingsDirtyIds,
} from './customSettingsRegistration';
import {
  customTabOwnsDescriptor,
  getCustomSettingsTab,
  getCustomTabsForSections,
  getScopedCustomTabsForSections,
  getSettingIdsForCustomTabSections,
  removeCustomClaimsFromSections,
} from './customSettingsRegistry';
import { SettingsSectionHost } from './SettingsSectionHost';
import { isManualSettingVisible } from './settingsCatalogProjection';
import { useSettingsStore } from './settingsStore';

export interface SettingsProjectionHostProps {
  tabId?: string;
  sections?: readonly SettingsSectionRef[];
  highlightedSettingIds?: ReadonlySet<string>;
  disabled?: boolean;
}

/**
 * One projection boundary for both manual navigation and AI results. Catalog
 * controls remain the fallback; richer registered tabs replace only the values
 * they explicitly own.
 */
export function SettingsProjectionHost({
  tabId,
  sections,
  highlightedSettingIds,
  disabled = false,
}: SettingsProjectionHostProps) {
  const catalogState = useSyncExternalStore(
    configCatalogStore.subscribe,
    configCatalogStore.getState,
    configCatalogStore.getState,
  );
  const snapshotState = useSyncExternalStore(
    configSnapshotStore.subscribe,
    configSnapshotStore.getState,
    configSnapshotStore.getState,
  );
  const markSettingDirty = useSettingsStore((state) => state.markSettingDirty);
  const clearSettingDirty = useSettingsStore((state) => state.clearSettingDirty);
  const dirtySettings = useSettingsStore((state) => state.dirtySettings);
  const { t: tAi } = useTranslation('settings/ai-mode');
  const customRenderRevisionRef = useRef(new Map<string, number | 'initial'>());
  const customSnapshotRevisionRef = useRef(new Map<string, number | 'initial'>());
  const customReportedDirtyRef = useRef(new Map<string, ReadonlySet<string>>());

  useEffect(() => {
    void configCatalogStore.load().catch(() => undefined);
  }, []);

  const exactCustomTab = tabId ? getCustomSettingsTab(tabId) : undefined;
  const descriptors = useMemo(
    () => catalogState.catalog?.settings ?? [],
    [catalogState.catalog?.settings],
  );
  const discoveredCustomTabs = useMemo(
    () => exactCustomTab
      ? [exactCustomTab]
      : getCustomTabsForSections(sections ?? [], descriptors),
    [descriptors, exactCustomTab, sections],
  );
  const customTabs = useMemo(
    () => sections
      ? getScopedCustomTabsForSections(sections, descriptors)
      : discoveredCustomTabs,
    [descriptors, discoveredCustomTabs, sections],
  );
  const catalogSections = useMemo(
    () => sections
      ? removeCustomClaimsFromSections(sections, descriptors, customTabs)
      : undefined,
    [customTabs, descriptors, sections],
  );
  const claimedSettingIds = useMemo(
    () => new Set(
      descriptors
        .filter((descriptor) => customTabs.some((tab) =>
          customTabOwnsDescriptor(tab, descriptor)
        ))
        .map((descriptor) => descriptor.id),
    ),
    [customTabs, descriptors],
  );
  const hasCatalogFallback = useMemo(() => {
    if (sections) {
      return Boolean(catalogSections?.length);
    }
    if (!tabId) {
      return true;
    }
    return descriptors.some((descriptor) =>
      isManualSettingVisible(descriptor)
      && descriptor.presentation.tabId === tabId
      && !claimedSettingIds.has(descriptor.id),
    );
  }, [catalogSections, claimedSettingIds, descriptors, sections, tabId]);

  return (
    <div className="sparo-settings-projection-host">
      {customTabs.map((registration) => {
        const Component = registration.component;
        const projectedSettingIds = sections
          ? getSettingIdsForCustomTabSections(registration, sections, descriptors)
          : undefined;
        const claimedDescriptors = descriptors.filter((descriptor) =>
          customTabOwnsDescriptor(registration, descriptor),
        );
        const highlighted = descriptors.some((descriptor) =>
          highlightedSettingIds?.has(descriptor.id)
          && customTabOwnsDescriptor(registration, descriptor),
        );
        const dirtySettingIds = (registration.draftSettingIds ?? []).filter(
          (settingId) => dirtySettings[settingId] !== undefined,
        );
        const hasDirtyClaim = dirtySettingIds.length > 0;
        const snapshotRevision = snapshotState.snapshot?.revision ?? 'initial';
        let projectionSnapshotRevision = customSnapshotRevisionRef.current.get(registration.id)
          ?? snapshotRevision;
        const claimedSettingChanged = projectionSnapshotRevision === 'initial'
          ? snapshotRevision !== 'initial'
          : claimedDescriptors.some((descriptor) =>
            configSnapshotStore.didSettingChangeAfter(
              descriptor.id,
              projectionSnapshotRevision as number,
            )
          );
        if (claimedSettingChanged) {
          projectionSnapshotRevision = snapshotRevision;
          customSnapshotRevisionRef.current.set(registration.id, projectionSnapshotRevision);
        }
        let renderRevision = customRenderRevisionRef.current.get(registration.id)
          ?? projectionSnapshotRevision;
        if (claimedDescriptors.length > 0 && !hasDirtyClaim) {
          renderRevision = projectionSnapshotRevision;
          customRenderRevisionRef.current.set(registration.id, renderRevision);
        }
        return (
          <div
            key={registration.id}
            ref={(element) => {
              element?.toggleAttribute('inert', disabled);
            }}
            className={[
              'sparo-settings-projection-host__custom',
              highlighted && 'is-highlighted',
            ].filter(Boolean).join(' ')}
            data-settings-custom-tab={registration.id}
            data-dirty-setting-ids={dirtySettingIds.join(' ')}
            data-settings-read-only={disabled || undefined}
            aria-disabled={disabled || undefined}
          >
            {dirtySettingIds.some((settingId) => {
              const baseRevision = dirtySettings[settingId];
              return baseRevision !== undefined
                && configSnapshotStore.didSettingChangeAfter(settingId, baseRevision);
            }) ? (
              <Alert type="warning" message={tAi('errors.manualConflict')} />
            ) : null}
            <Suspense
              fallback={(
                <div className="sparo-settings-projection-host__loading">
                  <LoadingSkeleton lines={5} />
                </div>
              )}
            >
              <Component
                key={claimedDescriptors.length > 0
                  ? `${registration.id}:${renderRevision}`
                  : registration.id}
                disabled={disabled}
                 snapshotRevision={projectionSnapshotRevision === 'initial'
                   ? null
                   : projectionSnapshotRevision}
                 settingIds={projectedSettingIds}
                 onDirtySettingIdsChange={(reportedSettingIds) => {
                  if (disabled) {
                    return;
                  }
                  const normalized = normalizeCustomSettingsDirtyIds(
                    registration,
                    reportedSettingIds,
                  );
                  const availableSettingIds = new Set(
                    claimedDescriptors.map((descriptor) => descriptor.id),
                  );
                  const unavailableSettingId = normalized.find(
                    (settingId) => !availableSettingIds.has(settingId),
                  );
                  if (unavailableSettingId) {
                    throw new Error(
                      `Custom settings tab ${registration.id} reported unavailable dirty setting ${unavailableSettingId}`,
                    );
                  }
                  const previous = customReportedDirtyRef.current.get(registration.id)
                    ?? new Set<string>();
                  const next = new Set(normalized);
                  const { added, removed } = diffCustomSettingsDirtyIds(previous, next);
                  const revision = snapshotState.snapshot?.revision;
                  if (added.length > 0 && revision === undefined) {
                    throw new Error(
                      `Custom settings tab ${registration.id} changed before the initial snapshot`,
                    );
                  }
                  for (const settingId of removed) {
                    clearSettingDirty(settingId);
                  }
                  for (const settingId of added) {
                    markSettingDirty(settingId, revision!);
                  }
                  if (next.size > 0) {
                    customReportedDirtyRef.current.set(registration.id, next);
                  } else {
                    customReportedDirtyRef.current.delete(registration.id);
                  }
                }}
              />
            </Suspense>
          </div>
        );
      })}

      {hasCatalogFallback ? (
        <SettingsSectionHost
          tabId={tabId}
          sections={catalogSections}
          highlightedSettingIds={highlightedSettingIds}
          excludedSettingIds={claimedSettingIds}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
