import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Search } from '@/design-system';
import {
  configCatalogStore,
  type SettingDescriptor,
} from '@/infrastructure/config';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import {
  SceneCompactNavCategory,
  SceneCompactNavItem,
} from '../shared/SceneCompactNav';
import {
  CUSTOM_SETTINGS_TABS,
  isDescriptorClaimedByCustomTab,
} from './customSettingsRegistry';
import { isManualSettingVisible } from './settingsCatalogProjection';
import { useSettingsStore } from './settingsStore';
import './SettingsNav.scss';

const SEARCH_DEBOUNCE_MS = 150;

interface SettingsTabProjection {
  id: string;
  categoryId: string;
  categoryOrder: number;
  order: number;
}

interface SettingsCategoryProjection {
  id: string;
  order: number;
  tabs: SettingsTabProjection[];
}

interface SettingsSearchRow {
  id: string;
  kind: 'setting' | 'customTab' | 'action';
  tabId: string;
  sectionId?: string;
  fieldId?: string;
  tabLabel: string;
  itemLabel?: string;
  description: string;
  haystack: string;
}

function humanizeId(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isVisibleCatalogSetting(descriptor: SettingDescriptor): boolean {
  return isManualSettingVisible(descriptor)
    && !isDescriptorClaimedByCustomTab(descriptor);
}

function buildNavigation(settings: readonly SettingDescriptor[]): SettingsCategoryProjection[] {
  const categories = new Map<string, {
    order: number;
    tabs: Map<string, SettingsTabProjection>;
  }>();

  const addTab = (tab: SettingsTabProjection) => {
    const category = categories.get(tab.categoryId) ?? {
      order: tab.categoryOrder,
      tabs: new Map<string, SettingsTabProjection>(),
    };
    category.order = Math.min(category.order, tab.categoryOrder);
    const existing = category.tabs.get(tab.id);
    if (!existing || tab.order < existing.order) {
      category.tabs.set(tab.id, tab);
    }
    categories.set(tab.categoryId, category);
  };

  for (const tab of CUSTOM_SETTINGS_TABS) {
    addTab({
      id: tab.id,
      categoryId: tab.categoryId,
      categoryOrder: tab.categoryOrder,
      order: tab.order,
    });
  }

  for (const descriptor of settings.filter(isVisibleCatalogSetting)) {
    const { categoryId, tabId, order } = descriptor.presentation;
    addTab({
      id: tabId,
      categoryId,
      categoryOrder: 10_000,
      order,
    });
  }

  return [...categories]
    .map(([id, category]) => ({
      id,
      order: category.order,
      tabs: [...category.tabs.values()].sort((left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
      ),
    }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

const SettingsNav: React.FC = () => {
  const { t, i18n } = useTranslation('settings/config-center');
  const catalogState = useSyncExternalStore(
    configCatalogStore.subscribe,
    configCatalogStore.getState,
    configCatalogStore.getState,
  );
  const activeTab = useSettingsStore((state) => state.activeTab);
  const setActiveTab = useSettingsStore((state) => state.setActiveTab);
  const searchQuery = useSettingsStore((state) => state.searchQuery);
  const setSearchQuery = useSettingsStore((state) => state.setSearchQuery);
  const openManualLocation = useSettingsStore((state) => state.openManualLocation);
  const [draftQuery, setDraftQuery] = useState(searchQuery);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const itemHover = useMovingHoverHighlight<HTMLDivElement>();

  useEffect(() => {
    void configCatalogStore.load().catch(() => undefined);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setSearchQuery(draftQuery),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [draftQuery, setSearchQuery]);

  const descriptors = useMemo(
    () => catalogState.catalog?.settings ?? [],
    [catalogState.catalog?.settings],
  );
  const categories = useMemo(
    () => buildNavigation(descriptors),
    [descriptors],
  );

  useEffect(() => {
    const hasActiveTab = categories.some((category) =>
      category.tabs.some((tab) => tab.id === activeTab),
    );
    const firstTab = categories[0]?.tabs[0]?.id;
    if (!hasActiveTab && firstTab) {
      setActiveTab(firstTab);
    }
  }, [activeTab, categories, setActiveTab]);

  const searchRows = useMemo<SettingsSearchRow[]>(() => {
    const catalogRows = descriptors
      .filter(isVisibleCatalogSetting)
      .map((descriptor): SettingsSearchRow => {
        const presentation = descriptor.presentation;
        const tabLabel = t(`tabs.${presentation.tabId}`, {
          defaultValue: humanizeId(presentation.tabId),
        });
        const itemLabelFallback = t(`fields.${presentation.fieldId}`, {
          defaultValue: humanizeId(presentation.fieldId),
        });
        const itemLabel = i18n.t(presentation.titleKey, {
          defaultValue: itemLabelFallback,
        });
        const description = presentation.descriptionKey
          ? i18n.t(presentation.descriptionKey, { defaultValue: '' })
          : '';
        return {
          id: `setting:${descriptor.id}`,
          kind: 'setting',
          tabId: presentation.tabId,
          sectionId: presentation.sectionId,
          fieldId: presentation.fieldId,
          tabLabel,
          itemLabel,
          description,
          haystack: [
            tabLabel,
            itemLabel,
            description,
            ...descriptor.ai.aliases,
            ...(descriptor.ai.tags ?? []),
          ].join(' ').toLocaleLowerCase(i18n.language),
        };
      });

    const customRows = CUSTOM_SETTINGS_TABS.flatMap((tab): SettingsSearchRow[] => {
      const tabLabel = t(tab.titleKey, { defaultValue: humanizeId(tab.id) });
      const description = t(tab.descriptionKey, { defaultValue: '' });
      const tabRow: SettingsSearchRow = {
        id: `custom-tab:${tab.id}`,
        kind: 'customTab',
        tabId: tab.id,
        tabLabel,
        description,
        haystack: [tabLabel, description, ...tab.aliases]
          .join(' ')
          .toLocaleLowerCase(i18n.language),
      };
      const actionRows = tab.actions.map((action): SettingsSearchRow => {
        const itemLabel = i18n.t(action.labelKey, {
          defaultValue: humanizeId(action.id.split('.').at(-1) ?? action.id),
        });
        return {
          id: `action:${action.id}`,
          kind: 'action',
          tabId: tab.id,
          tabLabel,
          itemLabel,
          description,
          haystack: [tabLabel, itemLabel, description, ...action.aliases]
            .join(' ')
            .toLocaleLowerCase(i18n.language),
        };
      });
      return [tabRow, ...actionRows];
    });

    return [...customRows, ...catalogRows];
  }, [descriptors, i18n, t]);

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase(i18n.language);
  const searchResults = normalizedQuery
    ? searchRows.filter((row) => row.haystack.includes(normalizedQuery))
    : [];
  const isSearchMode = draftQuery.trim().length > 0;

  useEffect(() => {
    setHighlightedIndex((current) => {
      if (searchResults.length === 0) {
        return -1;
      }
      return Math.min(current, searchResults.length - 1);
    });
  }, [searchResults.length]);

  const clearSearch = () => {
    setDraftQuery('');
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  const openSearchRow = (row: SettingsSearchRow) => {
    if (row.kind === 'setting') {
      openManualLocation({
        tabId: row.tabId,
        sectionId: row.sectionId,
        fieldId: row.fieldId,
      });
    } else {
      setActiveTab(row.tabId);
    }
    clearSearch();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
      return;
    }
    if (event.key === 'ArrowDown' && searchResults.length > 0) {
      event.preventDefault();
      setHighlightedIndex(0);
      resultsRef.current?.focus();
      return;
    }
    if (event.key === 'Enter' && searchResults.length === 1) {
      event.preventDefault();
      openSearchRow(searchResults[0]);
    }
  };

  const handleResultsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isSearchMode || searchResults.length === 0) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
      searchInputRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, searchResults.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) => {
        if (current <= 0) {
          searchInputRef.current?.focus();
          return -1;
        }
        return current - 1;
      });
      return;
    }
    if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault();
      openSearchRow(searchResults[highlightedIndex]);
    }
  };

  return (
    <div className="sparo-scene-compact-nav sparo-settings-nav">
      <div className="sparo-scene-compact-nav__header">
        <span className="sparo-scene-compact-nav__title">{t('title')}</span>
      </div>

      <div className="sparo-settings-nav__search">
        <Search
          ref={searchInputRef}
          className="sparo-settings-nav__search-field"
          size="small"
          value={draftQuery}
          onChange={setDraftQuery}
          onClear={clearSearch}
          onKeyDown={handleSearchKeyDown}
          enterToSearch={false}
          placeholder={t('searchPlaceholder')}
          inputAriaLabel={t('searchPlaceholder')}
          ariaControls="settings-nav-results"
          ariaExpanded={isSearchMode}
          clearable
        />
      </div>

      <div
        ref={(element) => {
          resultsRef.current = element;
          itemHover.setSurfaceElement(element);
        }}
        id="settings-nav-results"
        className="sparo-scene-compact-nav__sections sparo-scene-compact-nav__sections--motion"
        role={isSearchMode ? 'listbox' : undefined}
        tabIndex={isSearchMode && searchResults.length > 0 ? 0 : undefined}
        aria-activedescendant={highlightedIndex >= 0
          ? `settings-nav-result-${searchResults[highlightedIndex]?.id}`
          : undefined}
        onKeyDown={handleResultsKeyDown}
        {...itemHover.getSurfaceHandlers('.sparo-scene-compact-nav__item:not(:disabled)')}
      >
        <div
          className="sparo-scene-compact-nav__hover-highlight"
          style={{
            transform: `translate3d(${itemHover.highlight.left}px, ${itemHover.highlight.top}px, 0) scale(${itemHover.highlight.stretchX}, ${itemHover.highlight.stretchY})`,
            width: `${itemHover.highlight.width}px`,
            height: `${itemHover.highlight.height}px`,
            opacity: itemHover.highlight.visible && !isSearchMode ? 1 : 0,
          }}
        />

        {isSearchMode ? (
          searchResults.length > 0 ? (
            <div className="sparo-settings-nav__search-results">
              {searchResults.map((row, index) => (
                <Button
                  key={row.id}
                  id={`settings-nav-result-${row.id}`}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={activeTab === row.tabId}
                  className={[
                    'sparo-settings-nav__search-result-item',
                    activeTab === row.tabId && 'is-active',
                    highlightedIndex === index && 'is-highlighted',
                  ].filter(Boolean).join(' ')}
                  onClick={() => openSearchRow(row)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <span className="sparo-settings-nav__search-result-line">
                    {row.itemLabel ? `${row.tabLabel} / ${row.itemLabel}` : row.tabLabel}
                  </span>
                  {row.description ? (
                    <span className="sparo-settings-nav__search-result-desc">
                      {row.description}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
          ) : (
            <div className="sparo-settings-nav__search-empty" role="status">
              {t('searchNoResults')}
            </div>
          )
        ) : categories.map((category) => (
          <SceneCompactNavCategory
            key={category.id}
            label={t(`categories.${category.id}`, { defaultValue: humanizeId(category.id) })}
          >
            {category.tabs.map((tab) => (
              <SceneCompactNavItem
                key={tab.id}
                label={t(`tabs.${tab.id}`, { defaultValue: humanizeId(tab.id) })}
                active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </SceneCompactNavCategory>
        ))}
      </div>
    </div>
  );
};

export default SettingsNav;
