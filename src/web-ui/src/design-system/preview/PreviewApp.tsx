import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { designSystemPreviewCategories } from '@/design-system/preview/registries';
import type { PreviewCategory } from '../types';
import { FocusedPreview } from './FocusedPreview';
import {
  IconButton,
  Search,
  Select,
  SparoLogoMark,
  type SelectOption,
} from '@/design-system';
import { builtinThemes } from '@/infrastructure/theme/presets';
import {
  applyCssVars,
  createComponentCssVarMap,
  createLegacyCssVarMap,
  createThemeCssVarMap,
  type ThemeConfig,
} from '@/design-system/foundation/tokens';
import { builtinLocales } from '@/infrastructure/i18n';
import {
  Blocks,
  BookOpen,
  Box,
  Languages,
  PanelLeftClose,
  SunMedium,
} from 'lucide-react';
import './preview.css';

const PREVIEW_NAMESPACE = 'design-system/preview' as const;

function TierIcon({ category }: { category: PreviewCategory }) {
  if (category.tier === 'pattern') {
    return <Blocks size={15} aria-hidden="true" />;
  }
  if (category.tier === 'recipe') {
    return <BookOpen size={15} aria-hidden="true" />;
  }
  return <Box size={15} aria-hidden="true" />;
}

export const PreviewApp: React.FC = () => {
  const sourceRegistry = useMemo(() => designSystemPreviewCategories, []);
  const themes = useMemo(() => builtinThemes, []);
  const { t, i18n } = useTranslation(PREVIEW_NAMESPACE);
  const supportedLocales = useMemo(() => builtinLocales, []);
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language;
  const [themeId, setThemeId] = useState<string>('light');
  const [selectedCategory, setSelectedCategory] = useState<string>(
    sourceRegistry[0]?.id || ''
  );
  const [selectedExampleId, setSelectedExampleId] = useState<string>(
    sourceRegistry[0]?.examples[0]?.id || ''
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previewRegistry = useMemo(
    () =>
      sourceRegistry.map((category) => ({
        ...category,
        name: t(`catalog.categories.${category.id}.name`, {
          defaultValue: category.name,
        }),
        description: t(`catalog.categories.${category.id}.description`, {
          defaultValue: category.description,
        }),
        examples: category.examples.map((example) => ({
          ...example,
          name: t(`catalog.examples.${example.id}.name`, {
            defaultValue: example.name,
          }),
          description: t(`catalog.examples.${example.id}.description`, {
            defaultValue: example.description,
          }),
        })),
      })),
    [sourceRegistry, t]
  );

  const theme = themes.find((item) => item.id === themeId) ?? themes[0];

  React.useEffect(() => {
    document.title = t('documentTitle');
    document.documentElement.setAttribute('lang', currentLanguage);
    document.documentElement.setAttribute('dir', 'ltr');
  }, [currentLanguage, t]);

  React.useEffect(() => {
    if (!theme || typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const config = theme as unknown as ThemeConfig;
    applyCssVars(root, createThemeCssVarMap(config));
    applyCssVars(root, createLegacyCssVarMap(config));
    applyCssVars(root, createComponentCssVarMap(config));
    root.dataset.theme = theme.id;
    root.dataset.themeType = theme.type;
  }, [theme]);

  React.useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const isSlashShortcut = event.key === '/' && !isTyping;

      if (!isShortcut && !isSlashShortcut) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRegistry = useMemo(() => {
    if (!normalizedQuery) {
      return previewRegistry;
    }

    return previewRegistry
      .map((category) => {
        const sourceCategory = sourceRegistry.find((item) => item.id === category.id);
        const categoryMatches = [
          category.name,
          category.description,
          category.tier,
          sourceCategory?.name,
          sourceCategory?.description,
        ].some((value) => value?.toLowerCase().includes(normalizedQuery));
        const examples = categoryMatches
          ? category.examples
          : category.examples.filter((example) => {
              const sourceExample = sourceCategory?.examples.find(
                (item) => item.id === example.id
              );
              return [
                example.name,
                example.description,
                example.id,
                sourceExample?.name,
                sourceExample?.description,
              ].some((value) => value?.toLowerCase().includes(normalizedQuery));
            });

        return { ...category, examples };
      })
      .filter((category) => category.examples.length > 0);
  }, [normalizedQuery, previewRegistry, sourceRegistry]);

  const currentCategory = filteredRegistry.find(
    (category) => category.id === selectedCategory
  ) ?? filteredRegistry[0];
  const currentExample = currentCategory?.examples.find(
    (example) => example.id === selectedExampleId
  ) ?? currentCategory?.examples[0];
  const currentExampleIndex = currentCategory && currentExample
    ? currentCategory.examples.findIndex((example) => example.id === currentExample.id)
    : 0;
  const previousExample = currentCategory && currentExample
    ? currentCategory.examples[
        (currentExampleIndex - 1 + currentCategory.examples.length) % currentCategory.examples.length
      ]
    : undefined;
  const nextExample = currentCategory && currentExample
    ? currentCategory.examples[
        (currentExampleIndex + 1) % currentCategory.examples.length
      ]
    : undefined;
  const totalExamples = previewRegistry.reduce(
    (total, category) => total + category.examples.length,
    0
  );
  const resultCount = filteredRegistry.reduce(
    (total, category) => total + category.examples.length,
    0
  );
  const themeOptions = useMemo<SelectOption[]>(
    () =>
      themes.map((theme) => ({
        label: t(`themes.${theme.id}.name`, { defaultValue: theme.name }),
        value: theme.id,
        description: t(`themes.${theme.id}.description`, {
          defaultValue: theme.type === 'light'
            ? t('themes.lightDescription')
            : t('themes.darkDescription'),
        }),
      })),
    [t, themes]
  );
  const languageOptions = useMemo<SelectOption[]>(
    () =>
      supportedLocales.map((locale) => ({
        label: locale.nativeName,
        value: locale.id,
        description: locale.englishName,
      })),
    [supportedLocales]
  );

  React.useEffect(() => {
    if (!currentCategory || !currentExample) {
      return;
    }

    if (currentCategory.id !== selectedCategory) {
      setSelectedCategory(currentCategory.id);
    }
    if (currentExample.id !== selectedExampleId) {
      setSelectedExampleId(currentExample.id);
    }
  }, [currentCategory, currentExample, selectedCategory, selectedExampleId]);

  const selectCategory = (category: PreviewCategory) => {
    setSelectedCategory(category.id);
    setSelectedExampleId(category.examples[0]?.id ?? '');
  };

  const selectExample = (categoryId: string, exampleId: string) => {
    setSelectedCategory(categoryId);
    setSelectedExampleId(exampleId);
  };

  const selectRelativeExample = (direction: 'previous' | 'next') => {
    const target = direction === 'previous' ? previousExample : nextExample;
    if (target) {
      setSelectedExampleId(target.id);
    }
  };

  return (
    <div className="preview-app">
      <header className="preview-header">
        <div className="preview-brand">
          <span className="preview-brand__mark">
            <SparoLogoMark size={20} aria-hidden="true" />
          </span>
          <div className="preview-brand__copy">
            <h1>Sparo</h1>
            <span>{t('header.designSystem')}</span>
          </div>
          <span className="preview-version">v0.1</span>
        </div>
        <div className="preview-header-actions">
          <div className="preview-theme-selector preview-language-selector">
            <span className="preview-theme-selector__label">
              <Languages size={14} aria-hidden="true" />
              {t('header.previewLanguage')}
            </span>
            <Select
              className="preview-theme-selector__select-control preview-language-selector__select-control"
              size="small"
              label={t('header.previewLanguage')}
              value={currentLanguage}
              options={languageOptions}
              onChange={(value) => {
                if (Array.isArray(value)) {
                  return;
                }
                const locale = supportedLocales.find(
                  (item) => item.id === String(value)
                )?.id;
                if (locale) {
                  void i18n.changeLanguage(locale);
                }
              }}
              placement="bottom"
              dropdownAlign="end"
            />
          </div>
          <div className="preview-theme-selector">
            <span className="preview-theme-selector__label">
              <SunMedium size={14} aria-hidden="true" />
              {t('header.previewTheme')}
            </span>
            <Select
              className="preview-theme-selector__select-control"
              size="small"
              label={t('header.previewTheme')}
              value={themeId ?? ''}
              options={themeOptions}
              onChange={(value) => {
                if (Array.isArray(value)) {
                  return;
                }
                setThemeId(String(value));
              }}
              disabled={themes.length === 0}
              placement="bottom"
              dropdownAlign="end"
            />
          </div>
        </div>
      </header>

      <div className="preview-container">
        <aside className={`preview-sidebar ${isSidebarCollapsed ? 'preview-sidebar--collapsed' : ''}`}>
          <div className="preview-sidebar-header">
            <div className="preview-sidebar-heading">
              <span className="preview-sidebar-title">{t('sidebar.library')}</span>
              <span className="preview-sidebar-total">{totalExamples}</span>
            </div>
            <IconButton
              className="preview-sidebar-toggle"
              size="small"
              variant="ghost"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              aria-label={isSidebarCollapsed
                ? t('sidebar.expandNavigation')
                : t('sidebar.collapseNavigation')}
              tooltip={isSidebarCollapsed
                ? t('sidebar.expandNavigation')
                : t('sidebar.collapseNavigation')}
            >
              <span className={`preview-sidebar-toggle__icon ${isSidebarCollapsed ? 'is-collapsed' : ''}`}>
                <PanelLeftClose size={14} aria-hidden="true" />
              </span>
            </IconButton>
          </div>

          <div className="preview-sidebar-search">
            <Search
              ref={searchInputRef}
              size="small"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('sidebar.searchPlaceholder')}
              inputAriaLabel={t('sidebar.searchAriaLabel')}
              ariaControls="preview-library-navigation"
              suffixContent={<kbd>⌘K</kbd>}
            />
          </div>

          <nav
            id="preview-library-navigation"
            className="preview-nav"
            aria-label={t('sidebar.navigationAriaLabel')}
          >
            {filteredRegistry.map((category: PreviewCategory) => {
              const isOpen = currentCategory?.id === category.id || Boolean(normalizedQuery);

              return (
                <section
                  key={category.id}
                  className={`category-section ${isOpen ? 'category-section--open' : ''}`}
                >
                  <button
                    className={`category-button ${
                      currentCategory?.id === category.id ? 'active' : ''
                    }`}
                    onClick={() => selectCategory(category)}
                    title={category.name}
                    aria-label={category.name}
                    aria-expanded={isOpen}
                  >
                    <span className="category-button__icon">
                      <TierIcon category={category} />
                    </span>
                    <span className="category-name">{category.name}</span>
                    <span className="example-count">{category.examples.length}</span>
                  </button>
                  {isOpen && (
                    <div
                      className="category-examples"
                      aria-label={t('sidebar.categoryExamplesAriaLabel', {
                        category: category.name,
                      })}
                    >
                      {category.examples.map((example) => (
                        <button
                          key={example.id}
                          className={`category-example-button ${
                            currentExample?.id === example.id ? 'active' : ''
                          }`}
                          onClick={() => selectExample(category.id, example.id)}
                          title={example.description}
                        >
                          <span>{example.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </nav>

          {normalizedQuery && resultCount === 0 && (
            <div className="preview-sidebar-empty" role="status">
              <strong>{t('empty.noMatches')}</strong>
              <span>{t('empty.searchSuggestion')}</span>
            </div>
          )}

          {!isSidebarCollapsed && (
            <div className="preview-sidebar-footer">
              <span>{t('sidebar.shown', { count: resultCount })}</span>
              <span>{t('sidebar.searchShortcut')}</span>
            </div>
          )}
        </aside>

        <main className="preview-main">
          {currentCategory && currentExample && previousExample && nextExample ? (
            <FocusedPreview
              category={currentCategory}
              example={currentExample}
              index={currentExampleIndex}
              total={currentCategory.examples.length}
              previousExample={previousExample}
              nextExample={nextExample}
              onPrevious={() => selectRelativeExample('previous')}
              onNext={() => selectRelativeExample('next')}
            />
          ) : (
            <div className="empty-state">
              <strong>{t('empty.noPreview')}</strong>
              <p>{t('empty.previewSuggestion')}</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
