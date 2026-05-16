# Tool Card Recipe

Use this as the shell for AI/tool execution cards. Product-specific rendering stays in `flow_chat/tool-cards`.

## AI Rules

- Use `ToolCard` for reusable execution status framing and keep tool-specific payload rendering in `flow_chat/tool-cards`.
- Represent status with text and structure, not color alone.
- Preview default, disabled or unavailable action, loading/running, error, long text, narrow, theme, and i18n states.
- Include long tool names, long paths, streamed output, and failed execution messages in preview data.
- Keep card actions stable between running and completed states unless an action truly becomes unavailable.

```tsx
import { ToolCard, ToolCardBody, ToolCardFooter, ToolCardHeader } from '@/design-system';

export function ExampleToolCard() {
  return (
    <ToolCard status="running" tone="info">
      <ToolCardHeader icon={icon} title={t('title')} meta={t('running')} actions={actions} />
      <ToolCardBody>{content}</ToolCardBody>
      <ToolCardFooter>{footerActions}</ToolCardFooter>
    </ToolCard>
  );
}
```

## Migration Notes

- Flow chat card patterns are exposed through `@/design-system`.
- New shared shell work should target `@/design-system` and adapt product-specific cards around it.
- Preserve streaming behavior and status transitions during migration.
