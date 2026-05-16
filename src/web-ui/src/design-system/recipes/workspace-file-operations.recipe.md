# Workspace File Operations Recipe

Use this for file browsing, diff review, workspace status, and compact operation panes.

## AI Rules

- Use `ListDetail` or `NavigationList` when the user moves between paths, diffs, or workspace sections.
- Use `Panel`, `PanelHeader`, and `PanelBody` for dense file metadata rather than page-level cards.
- Use `DataList` for paths and operation rows; long paths must wrap or truncate with an accessible full value.
- Keep file-system reads, editor actions, and workspace services outside the design system.
- Preview empty folders, selected files, long paths, permission errors, narrow width, theme, and i18n states.

```tsx
import { DataList, DetailHeader, ListDetail, NavigationList, Panel, StatusBar } from '@/design-system';

export function WorkspaceFileOperations() {
  return (
    <ListDetail
      list={<NavigationList>{workspaceSections}</NavigationList>}
      detail={<Panel><DetailHeader title={selectedPath} />{fileDetails}</Panel>}
      footer={<StatusBar tone="info">{t('files.indexed')}</StatusBar>}
    />
  );
}
```

## Migration Notes

- Replace custom file operation containers with the shared list/detail and panel patterns.
- Preserve editor and diff behavior first, then normalize visual density through design-system tokens.
