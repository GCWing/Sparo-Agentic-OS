# Scene Page Recipe

Use this for normal app scenes.

## AI Rules

- Use one `SceneHeader` for the page title, description, and primary actions.
- Use `Panel` for bounded functional areas instead of page-level cards.
- Put repeated commands in `Toolbar` and group related controls with `ToolbarGroup`.
- Preview reusable scene shells with default, loading, error, long text, narrow, theme, and i18n states.
- Keep action labels translated and resilient to copy expansion.

```tsx
import {
  Button,
  Panel,
  PanelBody,
  PanelHeader,
  Scene,
  SceneBody,
  SceneHeader,
  Toolbar,
  ToolbarGroup,
} from '@/design-system';

export function ExampleScene() {
  return (
    <Scene>
      <SceneHeader
        title={t('title')}
        description={t('description')}
        actions={<Button variant="accent">{t('new')}</Button>}
      />
      <SceneBody>
        <Panel>
          <PanelHeader
            title={t('panel.title')}
            actions={
              <Toolbar density="compact">
                <ToolbarGroup align="end">{actions}</ToolbarGroup>
              </Toolbar>
            }
          />
          <PanelBody>{content}</PanelBody>
        </Panel>
      </SceneBody>
    </Scene>
  );
}
```

## Migration Notes

- Move new scene-level composition to `@/design-system` imports.
- Keep product-specific state, data loading, and side effects in the feature folder.
- When replacing legacy layout wrappers, migrate one scene surface at a time and keep behavior unchanged.
