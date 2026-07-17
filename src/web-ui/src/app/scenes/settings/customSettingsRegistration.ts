import type { ComponentType, LazyExoticComponent } from 'react';
import type { CustomSettingsProjectionProps } from '@/infrastructure/config';

export interface CustomSettingsActionRegistration {
  /** Stable action identity. Actions are deliberately not configuration values. */
  id: string;
  labelKey: string;
  aliases: readonly string[];
}

export type CustomSettingsComponentProps = CustomSettingsProjectionProps;

export interface CustomSettingsSectionClaim {
  tabId: string;
  sectionId: string;
}

export interface CustomSettingsTabRegistration {
  id: string;
  categoryId: string;
  categoryOrder: number;
  order: number;
  titleKey: string;
  descriptionKey: string;
  aliases: readonly string[];
  /** Stable Catalog setting IDs/namespaces owned by this richer projection. */
  claimedSettingNamespaces?: readonly string[];
  /** Stable presentation sections owned as a whole by this richer projection. */
  claimedSections?: readonly CustomSettingsSectionClaim[];
  /**
   * The component honors `settingIds` and can render an exact result subset.
   * Registrations without this capability stay full-page-only; bounded result
   * projections use Catalog controls instead of mounting unrelated content.
   */
  supportsScopedProjection?: boolean;
  /** Exact Catalog setting IDs for which this component can retain a local draft. */
  draftSettingIds?: readonly string[];
  actions: readonly CustomSettingsActionRegistration[];
  component: LazyExoticComponent<ComponentType<CustomSettingsComponentProps>>;
}

export interface CustomSettingsRegistrationModule {
  default: CustomSettingsTabRegistration;
}

export function defineCustomSettingsTab(
  registration: Omit<CustomSettingsTabRegistration, 'titleKey' | 'descriptionKey'>,
): CustomSettingsTabRegistration {
  const draftSettingIds = registration.draftSettingIds ?? [];
  const uniqueDraftSettingIds = new Set(draftSettingIds);
  if (
    uniqueDraftSettingIds.size !== draftSettingIds.length
    || draftSettingIds.some((settingId) => settingId.trim() !== settingId || !settingId)
  ) {
    throw new Error(`Custom settings tab ${registration.id} declares invalid draft setting IDs`);
  }
  for (const settingId of draftSettingIds) {
    const isClaimed = registration.claimedSettingNamespaces?.some(
      (namespace) => settingId === namespace || settingId.startsWith(`${namespace}.`),
    ) ?? false;
    if (!isClaimed) {
      throw new Error(
        `Custom settings tab ${registration.id} cannot draft unclaimed setting ${settingId}`,
      );
    }
  }
  return {
    ...registration,
    titleKey: `tabs.${registration.id}`,
    descriptionKey: `tabDescriptions.${registration.id}`,
  };
}

export function normalizeCustomSettingsDirtyIds(
  registration: CustomSettingsTabRegistration,
  reportedSettingIds: readonly string[],
): string[] {
  const reported = new Set(reportedSettingIds);
  const declared = registration.draftSettingIds ?? [];
  for (const settingId of reported) {
    if (!declared.includes(settingId)) {
      throw new Error(
        `Custom settings tab ${registration.id} reported undeclared dirty setting ${settingId}`,
      );
    }
  }
  return declared.filter((settingId) => reported.has(settingId));
}

export function diffCustomSettingsDirtyIds(
  previousSettingIds: ReadonlySet<string>,
  nextSettingIds: ReadonlySet<string>,
): { added: string[]; removed: string[] } {
  return {
    added: [...nextSettingIds].filter((settingId) => !previousSettingIds.has(settingId)),
    removed: [...previousSettingIds].filter((settingId) => !nextSettingIds.has(settingId)),
  };
}
