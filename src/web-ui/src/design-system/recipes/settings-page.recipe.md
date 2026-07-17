# Settings Page Recipe

Use this for configuration, preferences, provider setup, and admin-like screens.

## AI Rules

- Use `SceneHeader` for the visible page title and global actions. `SettingsPage` owns section width and rhythm; its native `title` attribute is not a page heading.
- Use `SettingsPage` and `SettingsSection` for page structure, then `FormSection`, `FormField`, and primitives for controls.
- Choose `SettingsPage` width deliberately: `narrow` for short focused forms, `default` for normal settings, `wide` for dense or multi-column content, and `full` only when the workflow needs the available scene width.
- Use horizontal `FormField` rows for dense desktop settings. Select `controlWidth="compact"`, `"balanced"`, or `"wide"` from the control's real space needs; the row automatically stacks in a narrow form container.
- Give every rendered section and field a stable Catalog coordinate through `data-setting-section` and `data-setting-id`. Do not derive these identifiers from translated labels or storage paths.
- Generate navigation, search, basic fields, and affected-section ordering from the Config Catalog. Keep only exceptional field or section renderers in product code.
- A dual-mode settings scene uses one global `ModeSwitch`: manual mode shows normal navigation and settings; AI mode shows one auto-resizing input, structured run state, and real affected sections. Do not turn AI mode into a second chat surface.
- Manual and AI modes must reuse the same section renderer and snapshot/transaction binding. AI results must not render copied labels, simulated values, or a parallel form.
- Mark changed, conflicted, partial, and restart-required fields with text or status affordances as well as visual emphasis.
- Use switches only for immediate binary settings; use selects, segmented controls, or radio groups for option sets.
- Bind a Catalog number schema with `nullable: true` to `NumberField`'s nullable contract. Render `null` as an empty input with translated "not set" copy; never coerce it to zero.
- Reusable previews must cover default, disabled or loading, error, long text, narrow, theme, and i18n states.
- Keep descriptions concise and translated in the surrounding `settings/*` locale namespace.

```tsx
import { useState } from 'react';
import {
  Button,
  FormActions,
  FormField,
  FormSection,
  ModeSwitch,
  Scene,
  SceneBody,
  SceneHeader,
  Select,
  SettingsPage,
  SettingsSection,
  Switch,
  Textarea,
} from '@/design-system';

type SettingsMode = 'manual' | 'ai';

function GeneralSettingsSection({ changed = false }: { changed?: boolean }) {
  return (
    <SettingsSection
      data-setting-section="general.behavior"
      title={t('general.title')}
      description={t('general.description')}
    >
      <FormSection>
        <FormField
          data-setting-id="general.provider"
          orientation="horizontal"
          controlWidth="balanced"
          label={t('general.provider.label')}
        >
          <Select options={providerOptions} value={provider} onChange={handleProviderChange} />
        </FormField>
        <FormField
          data-setting-id="general.enabled"
          data-setting-changed={changed || undefined}
          orientation="horizontal"
          controlWidth="compact"
          label={t('general.enabled.label')}
          description={changed ? t('result.changed') : t('general.enabled.description')}
        >
          <Switch checked={enabled} onChange={handleEnabledChange} />
        </FormField>
        <FormActions>
          <Button variant="ghost">{t('actions.reset')}</Button>
          <Button variant="primary">{t('actions.save')}</Button>
        </FormActions>
      </FormSection>
    </SettingsSection>
  );
}

export function ExampleSettingsScene() {
  const [mode, setMode] = useState<SettingsMode>('manual');

  return (
    <Scene>
      <SceneHeader
        title={t('title')}
        actions={(
          <ModeSwitch
            ariaLabel={t('mode.label')}
            value={mode}
            onChange={(value) => setMode(value as SettingsMode)}
            options={[
              { value: 'manual', label: t('mode.manual') },
              { value: 'ai', label: t('mode.ai') },
            ]}
          />
        )}
      />
      <SceneBody>
        {mode === 'manual' ? (
          <SettingsPage width="default">
            <GeneralSettingsSection />
          </SettingsPage>
        ) : (
          <SettingsPage width="wide">
            <Textarea
              aria-label={t('ai.inputLabel')}
              placeholder={t('ai.inputPlaceholder')}
              autoResize
            />
            {commitAffectsGeneral ? <GeneralSettingsSection changed /> : null}
          </SettingsPage>
        )}
      </SceneBody>
    </Scene>
  );
}
```

## Migration Notes

- Replace legacy page shells, form rows, setting cards, loading messages, and control wrappers directly with the public design-system patterns and primitives.
- Do not retain compatibility wrappers or create a feature-local settings component library.
- Keep Catalog lookup, persistence, validation, dirty-path conflict handling, apply receipts, and custom renderer registration in infrastructure or product code.
- Keep the same renderer mounted in manual mode and AI result mode; only the projection and result annotations differ.
