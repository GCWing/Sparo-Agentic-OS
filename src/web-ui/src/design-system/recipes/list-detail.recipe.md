# List Detail Recipe

Use this for master-detail workflows.

## AI Rules

- Use `DataList` for selectable rows and keep row actions inside the row or a nearby toolbar.
- Provide empty, loading, error, selected, long text, narrow, theme, and i18n preview states when the list-detail shell is reused.
- Keep the detail panel useful when nothing is selected; show an empty state rather than a blank panel.
- Long names, paths, and metadata must wrap or truncate intentionally in both the list and detail header.

```tsx
import {
  DataList,
  DataListEmpty,
  DataListItem,
  Panel,
  PanelBody,
  PanelHeader,
  Scene,
  SceneBody,
} from '@/design-system';

export function ExampleListDetail() {
  return (
    <Scene>
      <SceneBody className="feature-list-detail">
        <Panel>
          <PanelHeader title={t('items.title')} />
          <PanelBody>
            <DataList>
              {items.length === 0 ? (
                <DataListEmpty>{t('items.empty')}</DataListEmpty>
              ) : (
                items.map(item => (
                  <DataListItem key={item.id} selected={item.id === selectedId}>
                    {item.name}
                  </DataListItem>
                ))
              )}
            </DataList>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title={selected?.name ?? t('detail.emptyTitle')} />
          <PanelBody>{detail}</PanelBody>
        </Panel>
      </SceneBody>
    </Scene>
  );
}
```

## Migration Notes

- Replace older local cards or list containers with `Panel`, `PanelHeader`, `PanelBody`, `DataList`, and `DataListItem`.
- Preserve selection behavior first, then update visual density and token usage.
