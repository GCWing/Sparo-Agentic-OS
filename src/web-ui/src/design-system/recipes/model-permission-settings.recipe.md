# Model Permission Settings Recipe

Use this for durable model, provider, workspace permission, and policy settings.

## AI Rules

- Use `SettingsPage` for the page shell and `SettingsSection` for each durable configuration group.
- Use `FormSection` and `FormField` for editable fields; compose with `Select`, `Switch`, `TextField`, and `NumberField`.
- Use `ConfirmDialog` for destructive provider or policy deletion.
- Keep provider state, validation, and persistence in infrastructure or feature code.
- Preview default, disabled, validation error, saving, loading, long labels, narrow width, theme, and i18n states.

```tsx
import { FormField, FormSection, NumberField, Select, SettingsPage, SettingsSection, Switch } from '@/design-system';

export function ModelPermissionSettings() {
  return (
    <SettingsPage title={t('settings.models')}>
      <SettingsSection title={t('settings.defaultModel')}>
        <FormSection>
          <FormField label={t('settings.provider')}>
            <Select value={providerId} options={providerOptions} onChange={setProviderId} />
          </FormField>
          <FormField label={t('settings.requireApproval')}>
            <Switch checked={requiresApproval} onChange={setRequiresApproval} />
          </FormField>
          <FormField label={t('settings.maxTokens')}>
            <NumberField value={maxTokens} onChange={setMaxTokens} min={1} />
          </FormField>
        </FormSection>
      </SettingsSection>
    </SettingsPage>
  );
}
```

## Migration Notes

- Do not style local inputs, selects, switches, or number fields inside settings pages.
- Keep user-visible labels translated in both supported locales.
