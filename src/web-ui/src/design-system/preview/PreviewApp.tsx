import React, { useMemo, useState } from 'react';
import { designSystemPreviewCategories } from '@/design-system/preview/registries';
import type { PreviewCategory } from '../types';
import { FullPageLayout, LargeCardLayout, GridLayout, DemoLayout, ColumnLayout } from './layouts';
import { IconButton, Select, type SelectOption } from '@/design-system';
import { builtinThemes } from '@/infrastructure/theme/presets';
import {
  applyCssVars,
  createComponentCssVarMap,
  createLegacyCssVarMap,
  createThemeCssVarMap,
  type ThemeConfig,
} from '@/design-system/foundation/tokens';
import { PanelLeftClose } from 'lucide-react';
import './preview.css';

export const PreviewApp: React.FC = () => {
  const previewRegistry = useMemo(() => designSystemPreviewCategories, []);
  const themes = useMemo(() => builtinThemes, []);
  const [themeId, setThemeId] = useState<string>('slate');
  const [selectedCategory, setSelectedCategory] = useState<string>(
    previewRegistry[0]?.id || ''
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const theme = themes.find((item) => item.id === themeId) ?? themes[0];
  const themeType = theme?.type === 'light' ? 'light' : 'dark';

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
    root.dataset.themeType = themeType;
  }, [theme, themeType]);

  const currentCategory = previewRegistry.find(
    (category) => category.id === selectedCategory
  );
  const themeTypeLabel = themeType === 'light' ? 'Light' : 'Dark';
  const themeOptions = useMemo<SelectOption[]>(
    () =>
      themes.map((theme) => ({
        label: theme.name,
        value: theme.id,
        description: theme.type === 'light'
          ? 'Light preview theme'
          : 'Dark preview theme',
      })),
    [themes]
  );

  const renderCurrentCategory = (category: PreviewCategory) => {
    if (category.layoutType === 'full-page') {
      return <FullPageLayout examples={category.examples} />;
    }
    if (category.layoutType === 'large-card') {
      return <LargeCardLayout examples={category.examples} />;
    }
    if (category.layoutType === 'demo') {
      return <DemoLayout examples={category.examples} />;
    }
    if (category.layoutType === 'column') {
      return <ColumnLayout examples={category.examples} />;
    }
    if (category.layoutType === 'grid-2') {
      return <GridLayout examples={category.examples} columns={2} />;
    }
    if (category.layoutType === 'grid-4') {
      return <GridLayout examples={category.examples} columns={4} />;
    }

    return <GridLayout examples={category.examples} columns={3} />;
  };

  return (
    <div className="preview-app">
      <header className="preview-header">
        <div className="preview-logo">
          <h1>Sparo Design System</h1>
          <span className="preview-version">v0.1.0</span>
        </div>
        <div className="preview-header-actions">
          <label className="preview-theme-selector">
            <span className="preview-theme-selector__label">
              Theme
            </span>
            <div className="preview-theme-selector__control">
              <Select
                className="preview-theme-selector__select-control"
                size="small"
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
              />
              <span className={`preview-theme-selector__badge preview-theme-selector__badge--${themeType}`}>
                {themeTypeLabel}
              </span>
            </div>
          </label>
        </div>
      </header>

      <div className="preview-container">
        <aside className={`preview-sidebar ${isSidebarCollapsed ? 'preview-sidebar--collapsed' : ''}`}>
          <div className="preview-sidebar-header">
            {!isSidebarCollapsed && (
              <span className="preview-sidebar-title">
                Library
              </span>
            )}
            <IconButton
              className="preview-sidebar-toggle"
              size="small"
              variant="ghost"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              aria-label={isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              tooltip={isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              <span className={`preview-sidebar-toggle__icon ${isSidebarCollapsed ? 'is-collapsed' : ''}`}>
                <PanelLeftClose size={14} aria-hidden="true" />
              </span>
            </IconButton>
          </div>
          <nav className="preview-nav">
            {previewRegistry.map((category: PreviewCategory) => (
              <div key={category.id} className="category-section">
                <button
                  className={`category-button ${
                    selectedCategory === category.id ? 'active' : ''
                  }`}
                  onClick={() => setSelectedCategory(category.id)}
                  title={category.name}
                >
                  <span className="category-button__dot" />
                  <span className="category-name">
                    {isSidebarCollapsed ? category.name.slice(0, 2) : category.name}
                  </span>
                  {!isSidebarCollapsed && (
                    <span className="example-count">
                      {category.examples.length}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </nav>
        </aside>

        <main className={`preview-main ${currentCategory?.layoutType === 'full-page' ? 'preview-main--full' : ''}`}>
          {currentCategory ? (
            <>
              {currentCategory.layoutType !== 'full-page' && (
                <div className="preview-surface-header">
                  {currentCategory.tier && (
                    <div className={`preview-surface-tier preview-surface-tier--${currentCategory.tier}`}>
                      {currentCategory.tier}
                    </div>
                  )}
                  <h2 className="preview-surface-title">{currentCategory.name}</h2>
                  <p className="preview-surface-description">
                    {currentCategory.description}
                  </p>
                  {currentCategory.aiRole && (
                    <p className="preview-surface-ai-role">{currentCategory.aiRole}</p>
                  )}
                  {currentCategory.decisionRules && currentCategory.decisionRules.length > 0 && (
                    <ul className="preview-surface-decision-rules">
                      {currentCategory.decisionRules.map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {renderCurrentCategory(currentCategory)}
            </>
          ) : (
            <div className="empty-state">
              <p>No preview category selected.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
