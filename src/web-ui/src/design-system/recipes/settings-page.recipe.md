# Settings Page Recipe

Use this for configuration, preferences, provider setup, and admin-like screens.

## AI Rules

- Use `SettingsPage` and `SettingsSection` for page structure, then `FormSection`, `FormField`, and primitives for controls.
- Use switches only for immediate binary settings; use selects, segmented controls, or radio groups for option sets.
- Form previews must include default, disabled, loading, error, long text, narrow, theme, and i18n states when the settings surface is reusable.
- Error previews should show both field-level validation and save-level failure when the form supports both.
- Keep descriptions concise and translated in the surrounding locale namespace.

```tsx
import {
  Button,
  FormActions,
  FormField,
  FormSection,
  Scene,
  SceneBody,
  SceneHeader,
  Select,
  SettingsPage,
  SettingsSection,
  Switch,
  TextField,
} from '@/design-system';

export function ExampleSettingsPage() {
  return (
    <Scene>
      <SceneHeader title={t('title')} description={t('description')} />
      <SceneBody>
        <SettingsPage>
          <SettingsSection title={t('general.title')} description={t('general.description')}>
            <FormSection>
              <FormField label={t('general.name.label')} description={t('general.name.description')}>
                <TextField value={name} onChange={handleNameChange} />
              </FormField>
              <FormField label={t('general.provider.label')}>
                <Select options={providerOptions} value={provider} onChange={handleProviderChange} />
              </FormField>
              <FormField label={t('general.enabled.label')}>
                <Switch checked={enabled} onChange={handleEnabledChange} />
              </FormField>
              <FormActions>
                <Button variant="ghost">{t('common.cancel')}</Button>
                <Button variant="accent">{t('common.save')}</Button>
              </FormActions>
            </FormSection>
          </SettingsSection>
        </SettingsPage>
      </SceneBody>
    </Scene>
  );
}
```

## Migration Notes

- Replace legacy form rows and custom setting cards with `SettingsSection` plus design-system form primitives.
- Keep existing persistence and validation behavior intact while migrating the visual shell.
