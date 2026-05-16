# Agent Session Workbench Recipe

Use this for desktop session, task, and agent activity surfaces where the user needs to scan work, select a target, and resume execution.

## AI Rules

- Use `Scene` for the page frame and `ListDetail` when the user chooses from sessions, tasks, or agent activity items.
- Use `DataList` for selectable rows and `InspectorPanel` for the focused item summary.
- Use `CommandBar` for primary resume, filter, and refresh actions; keep destructive actions secondary.
- Use `StatusBar` for pending review, running checks, and blocked permission states.
- Preview selected, empty, loading, error, long text, narrow, theme, and i18n states before shipping.

```tsx
import { CommandBar, DataList, InspectorPanel, ListDetail, Scene, StatusBar } from '@/design-system';

export function AgentSessionWorkbench() {
  return (
    <Scene>
      <CommandBar title={t('sessions.title')} primaryAction={resumeAction} />
      <ListDetail
        list={<DataList>{sessionRows}</DataList>}
        detail={<InspectorPanel title={selected.title}>{selectedSummary}</InspectorPanel>}
        footer={<StatusBar tone="warning">{t('sessions.reviewPending')}</StatusBar>}
      />
    </Scene>
  );
}
```

## Migration Notes

- Keep session lifecycle and agent runtime behavior in `app` or `flow_chat`; the design system owns only the shell and reusable interaction pattern.
- Do not create feature-local list cards for new session workbench surfaces.
