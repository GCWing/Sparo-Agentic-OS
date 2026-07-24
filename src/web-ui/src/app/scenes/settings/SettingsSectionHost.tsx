import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FormSection,
  LoadingSkeleton,
  SettingsSection,
} from '@/design-system';
import {
  ConfigConfirmationRejectedError,
  configCatalogStore,
  configTransactionClient,
  SettingRenderer,
  type SettingDescriptor,
  type SettingsSectionRef,
} from '@/infrastructure/config';
import { useSettingsStore } from './settingsStore';
import { isManualSettingVisible } from './settingsCatalogProjection';
import { useSettingsConfirmation } from './settingsConfirmationContext';

export interface SettingsSectionHostProps {
  tabId?: string;
  sections?: readonly SettingsSectionRef[];
  highlightedSettingIds?: ReadonlySet<string>;
  excludedSettingIds?: ReadonlySet<string>;
  disabled?: boolean;
}

interface SectionGroup {
  ref: SettingsSectionRef;
  descriptors: SettingDescriptor[];
}

function humanizeId(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getSectionFallback(
  sectionId: string,
  translate: (key: string, options: { defaultValue: string }) => string,
): string {
  const advancedTabId = sectionId.startsWith('advanced-')
    ? sectionId.slice('advanced-'.length)
    : null;
  return advancedTabId
    ? translate(`tabs.${advancedTabId}`, { defaultValue: humanizeId(advancedTabId) })
    : humanizeId(sectionId);
}

export function SettingsSectionHost({
  tabId,
  sections,
  highlightedSettingIds = new Set<string>(),
  excludedSettingIds = new Set<string>(),
  disabled = false,
}: SettingsSectionHostProps) {
  const { t: tCenter, i18n } = useTranslation('settings/config-center');
  const { t: tAi } = useTranslation('settings/ai-mode');
  const catalogState = useSyncExternalStore(
    configCatalogStore.subscribe,
    configCatalogStore.getState,
    configCatalogStore.getState,
  );
  const manualTarget = useSettingsStore((state) => state.manualTarget);
  const clearManualTarget = useSettingsStore((state) => state.clearManualTarget);
  const markSettingDirty = useSettingsStore((state) => state.markSettingDirty);
  const clearSettingDirty = useSettingsStore((state) => state.clearSettingDirty);
  const rootRef = useRef<HTMLDivElement>(null);
  const [errorKey, setErrorKey] = useState<'conflict' | 'manualConflict' | 'submit' | null>(null);
  const requestConfirmation = useSettingsConfirmation();

  useEffect(() => {
    void configCatalogStore.load().catch(() => undefined);
  }, []);

  const groups = useMemo<SectionGroup[]>(() => {
    const descriptors = (catalogState.catalog?.settings ?? [])
      .filter(isManualSettingVisible)
      .filter((descriptor) => !excludedSettingIds.has(descriptor.id))
      .filter((descriptor) => !tabId || descriptor.presentation.tabId === tabId);
    const requested = sections?.length
      ? sections
      : [...new Map(descriptors.map((descriptor) => {
          const presentation = descriptor.presentation;
          const key = `${presentation.tabId}:${presentation.sectionId}`;
          return [key, {
            categoryId: presentation.categoryId,
            tabId: presentation.tabId,
            sectionId: presentation.sectionId,
            fieldIds: [] as string[],
          } satisfies SettingsSectionRef];
        })).values()];

    return requested
      .map((sectionRef) => ({
        ref: sectionRef,
        descriptors: descriptors
          .filter((descriptor) =>
            descriptor.presentation.tabId === sectionRef.tabId
            && descriptor.presentation.sectionId === sectionRef.sectionId
            && (
              sectionRef.fieldIds.length === 0
              || sectionRef.fieldIds.includes(descriptor.presentation.fieldId)
            ),
          )
          .sort((left, right) => left.presentation.order - right.presentation.order),
      }))
      .filter((group) => group.descriptors.length > 0);
  }, [catalogState.catalog, excludedSettingIds, sections, tabId]);

  useEffect(() => {
    if (!manualTarget || !rootRef.current || manualTarget.tabId !== tabId) {
      return;
    }
    const candidates = rootRef.current.querySelectorAll<HTMLElement>('[data-setting-field]');
    const target = [...candidates].find(
      (candidate) => candidate.dataset.settingField === manualTarget.fieldId,
    ) ?? rootRef.current.querySelector<HTMLElement>(
      `[data-setting-section="${manualTarget.sectionId ?? ''}"]`,
    );
    if (!target) {
      return;
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]')?.focus({
      preventScroll: true,
    });
    clearManualTarget();
  }, [clearManualTarget, groups, manualTarget, tabId]);

  if (catalogState.status === 'idle' || catalogState.status === 'loading') {
    return <LoadingSkeleton lines={5} />;
  }

  if (catalogState.error) {
    return <Alert type="error" message={tAi('errors.catalog')} />;
  }

  return (
    <div ref={rootRef} className="sparo-settings-section-host">
      {errorKey ? (
        <Alert
          type="error"
          message={tAi(`errors.${errorKey}`)}
          closable
          onClose={() => setErrorKey(null)}
        />
      ) : null}

      {groups.map((group) => (
        <SettingsSection
          key={`${group.ref.tabId}:${group.ref.sectionId}`}
          className="sparo-settings-section-host__section"
          data-setting-section={group.ref.sectionId}
          title={tCenter(`sections.${group.ref.sectionId}`, {
            defaultValue: getSectionFallback(group.ref.sectionId, tCenter),
          })}
        >
          <FormSection className="sparo-settings-section-host__fields">
            {group.descriptors.map((descriptor) => (
              <div
                key={descriptor.id}
                className={[
                  'sparo-settings-section-host__field',
                  highlightedSettingIds.has(descriptor.id) && 'is-highlighted',
                ].filter(Boolean).join(' ')}
                data-setting-id={descriptor.id}
                data-setting-field={descriptor.presentation.fieldId}
              >
                <SettingRenderer
                  settingId={descriptor.id}
                  translate={(key) => i18n.t(key, {
                    defaultValue: tCenter(`fields.${descriptor.presentation.fieldId}`, {
                      defaultValue: humanizeId(descriptor.presentation.fieldId),
                    }),
                  })}
                  disabled={disabled}
                  onConfirmationRequired={async (confirmationError) => {
                    if (!await requestConfirmation(confirmationError)) {
                      throw new ConfigConfirmationRejectedError();
                    }
                    const commitRequest = confirmationError.commitRequest;
                    if (!commitRequest) {
                      throw new Error('Config confirmation is missing its commit request');
                    }
                    await configTransactionClient.commit({
                      ...commitRequest,
                      planId: confirmationError.plan.planId,
                      expectedRevision: confirmationError.plan.baseRevision,
                      confirmed: true,
                    });
                  }}
                  onError={(settingError) => {
                    if (settingError.message.includes('config.manual_draft_conflict')) {
                      setErrorKey('manualConflict');
                    } else if (settingError.message.includes('config.revision_conflict')) {
                      setErrorKey('conflict');
                    } else {
                      setErrorKey('submit');
                    }
                  }}
                  onDirtyChange={(dirty, baseRevision) => {
                    if (dirty && baseRevision !== undefined) {
                      markSettingDirty(descriptor.id, baseRevision);
                    } else {
                      clearSettingDirty(descriptor.id);
                    }
                  }}
                />
              </div>
            ))}
          </FormSection>
        </SettingsSection>
      ))}
    </div>
  );
}
