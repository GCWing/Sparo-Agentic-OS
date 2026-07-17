import type { SettingDescriptor, SettingsSectionRef } from '@/infrastructure/config';
import type {
  CustomSettingsRegistrationModule,
  CustomSettingsTabRegistration,
} from './customSettingsRegistration';

const registrationModules = import.meta.glob<CustomSettingsRegistrationModule>(
  './custom-tabs/*.settings-tab.ts',
  { eager: true },
);

/**
 * Rich settings experiences register beside the projection layer that owns
 * them. This loader is deliberately generic: adding a tab never changes the
 * Settings scene or a central registration list.
 */
export const CUSTOM_SETTINGS_TABS: readonly CustomSettingsTabRegistration[] = Object
  .values(registrationModules)
  .map((module) => module.default)
  .sort((left, right) =>
    left.categoryOrder - right.categoryOrder || left.order - right.order,
  );

const CUSTOM_TAB_BY_ID = new Map(CUSTOM_SETTINGS_TABS.map((tab) => [tab.id, tab]));

function settingIdMatchesNamespace(settingId: string, namespace: string): boolean {
  return settingId === namespace || settingId.startsWith(`${namespace}.`);
}

export function getCustomSettingsTab(tabId: string): CustomSettingsTabRegistration | undefined {
  return CUSTOM_TAB_BY_ID.get(tabId);
}

export function customTabOwnsDescriptor(
  tab: CustomSettingsTabRegistration,
  descriptor: SettingDescriptor,
): boolean {
  const ownsSetting = tab.claimedSettingNamespaces?.some((namespace) =>
    settingIdMatchesNamespace(descriptor.id, namespace)
  ) ?? false;
  if (ownsSetting) {
    return true;
  }
  return tab.claimedSections?.some((section) =>
    descriptor.presentation.tabId === section.tabId
    && descriptor.presentation.sectionId === section.sectionId
  ) ?? false;
}

export function isDescriptorClaimedByCustomTab(descriptor: SettingDescriptor): boolean {
  return CUSTOM_SETTINGS_TABS.some((tab) => customTabOwnsDescriptor(tab, descriptor));
}

function descriptorsForSection(
  section: SettingsSectionRef,
  descriptors: readonly SettingDescriptor[],
): SettingDescriptor[] {
  return descriptors.filter((descriptor) => {
    const presentation = descriptor.presentation;
    return presentation.tabId === section.tabId
      && presentation.sectionId === section.sectionId
      && (
        section.fieldIds.length === 0
        || section.fieldIds.includes(presentation.fieldId)
      );
  });
}

export function getCustomTabsForSections(
  sections: readonly SettingsSectionRef[],
  descriptors: readonly SettingDescriptor[],
): CustomSettingsTabRegistration[] {
  const selected = new Set<CustomSettingsTabRegistration>();

  for (const section of sections) {
    const matches = descriptorsForSection(section, descriptors);
    const directTab = getCustomSettingsTab(section.tabId);
    if (
      directTab
      && (
        matches.length === 0
        || matches.some((descriptor) => customTabOwnsDescriptor(directTab, descriptor))
      )
    ) {
      selected.add(directTab);
    }
    for (const descriptor of matches) {
      for (const tab of CUSTOM_SETTINGS_TABS) {
        if (customTabOwnsDescriptor(tab, descriptor)) {
          selected.add(tab);
        }
      }
    }
  }

  return [...selected].sort((left, right) =>
    left.categoryOrder - right.categoryOrder || left.order - right.order,
  );
}

export function getScopedCustomTabsForSections(
  sections: readonly SettingsSectionRef[],
  descriptors: readonly SettingDescriptor[],
): CustomSettingsTabRegistration[] {
  return getCustomTabsForSections(sections, descriptors)
    .filter((tab) => tab.supportsScopedProjection);
}

export function getSettingIdsForCustomTabSections(
  tab: CustomSettingsTabRegistration,
  sections: readonly SettingsSectionRef[],
  descriptors: readonly SettingDescriptor[],
): string[] {
  const settingIds = new Set<string>();
  for (const section of sections) {
    for (const descriptor of descriptorsForSection(section, descriptors)) {
      if (customTabOwnsDescriptor(tab, descriptor)) {
        settingIds.add(descriptor.id);
      }
    }
  }
  return [...settingIds];
}

export function removeCustomClaimsFromSections(
  sections: readonly SettingsSectionRef[],
  descriptors: readonly SettingDescriptor[],
  projectedTabs: readonly CustomSettingsTabRegistration[],
): SettingsSectionRef[] {
  return sections.flatMap((section) => {
    const matches = descriptorsForSection(section, descriptors);
    if (matches.length === 0) {
      return projectedTabs.some((tab) => tab.id === section.tabId) ? [] : [section];
    }
    const remainingFieldIds = matches
      .filter((descriptor) => !projectedTabs.some((tab) =>
        customTabOwnsDescriptor(tab, descriptor)
      ))
      .map((descriptor) => descriptor.presentation.fieldId);
    if (remainingFieldIds.length === 0) {
      return [];
    }
    return [{ ...section, fieldIds: remainingFieldIds }];
  });
}
