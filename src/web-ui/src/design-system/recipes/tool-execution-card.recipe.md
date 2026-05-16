# Tool Execution Card Recipe

Use this for AI and tool execution output in Flow Chat or related agent timelines.

## AI Rules

- Use `ToolCard` for status framing and keep tool-specific payload rendering in product-owned `flow_chat/tool-cards`.
- Use `ToolCardHeader`, `ToolCardBody`, and `ToolCardFooter` for stable layout across pending, running, completed, and failed states.
- Represent status with text and structure, not color alone.
- Keep action placement stable while the tool streams or completes.
- Preview pending, running, completed, error, long output, copied state, narrow width, theme, and i18n states.

```tsx
import { Button, ToolCard, ToolCardBody, ToolCardFooter, ToolCardHeader } from '@/design-system';

export function ToolExecutionCard() {
  return (
    <ToolCard status={status} tone={tone}>
      <ToolCardHeader title={title} meta={statusLabel} actions={headerActions} />
      <ToolCardBody>{toolPayload}</ToolCardBody>
      <ToolCardFooter>
        <Button size="small" variant="secondary">{t('tool.copy')}</Button>
      </ToolCardFooter>
    </ToolCard>
  );
}
```

## Migration Notes

- Product-specific parsers, file actions, terminal output, and streaming logic stay outside the design system.
- New shared tool-card shell work should target `@/design-system`.
