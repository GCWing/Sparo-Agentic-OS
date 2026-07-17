# Model Permission Settings Recipe

Use this for durable model, provider, workspace permission, and policy settings.

## AI Rules

- Use `SceneHeader` for the page title and `SettingsPage` for the bounded settings content. Do not pass a visual heading through the native `SettingsPage` `title` attribute.
- Use `SettingsSection` for each durable Catalog section and `FormSection` plus `FormField` for editable fields.
- Attach stable `data-setting-section` and `data-setting-id` values from the Config Catalog. Never use provider names, translated text, or dot-path storage locations as product identity.
- Prefer horizontal fields for dense desktop forms. Use `controlWidth="balanced"` for normal selectors and `"wide"` for model names, endpoints, or policy editors; narrow containers stack automatically.
- Compose controls from `Select`, `Switch`, `TextField`, `NumberField`, and the other public primitives. Do not style local inputs, selects, switches, or number fields.
- Use `ConfirmDialog` for destructive provider or policy deletion. Secret values use a dedicated secure-input flow and must not be projected into AI history or commit diffs.
- Keep provider state, validation, transactions, runtime apply receipts, and custom renderers in infrastructure or feature code.
- When an AI settings commit affects this section, render this same section component against the shared snapshot and annotate the changed fields. Do not build an AI-specific copy.
- Preview default, disabled, validation error, saving or loading, long labels, narrow width, theme, and i18n states.

```tsx
import {
  FormField,
  FormSection,
  NumberField,
  Scene,
  SceneBody,
  SceneHeader,
  Select,
  SettingsPage,
  SettingsSection,
  Switch,
} from '@/design-system';

export function ModelPermissionSettings() {
  return (
    <Scene>
      <SceneHeader title={t('title')} description={t('description')} />
      <SceneBody>
        <SettingsPage width="default">
          <SettingsSection
            data-setting-section="models.defaults"
            title={t('sections.defaults.title')}
            description={t('sections.defaults.description')}
          >
            <FormSection>
              <FormField
                data-setting-id="models.default"
                orientation="horizontal"
                controlWidth="wide"
                label={t('fields.defaultModel.label')}
              >
                <Select value={providerId} options={providerOptions} onChange={setProviderId} />
              </FormField>
              <FormField
                data-setting-id="permissions.workspace.requireApproval"
                orientation="horizontal"
                controlWidth="compact"
                label={t('fields.requireApproval.label')}
              >
                <Switch checked={requiresApproval} onChange={setRequiresApproval} />
              </FormField>
              <FormField
                data-setting-id="models.maxTokens"
                orientation="horizontal"
                controlWidth="balanced"
                label={t('fields.maxTokens.label')}
              >
                <NumberField value={maxTokens} onChange={setMaxTokens} min={1} />
              </FormField>
            </FormSection>
          </SettingsSection>
        </SettingsPage>
      </SceneBody>
    </Scene>
  );
}
```

## Migration Notes

- Delete feature-local form and control wrappers after migrating their consumers to the public design-system API.
- Catalog descriptors own stable setting and section IDs; locale namespaces own user-visible titles and descriptions.
- Manual settings, AI results, deep links, search, and automated tests must resolve the same section renderer.
