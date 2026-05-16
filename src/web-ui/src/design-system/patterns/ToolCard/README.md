# ToolCard Pattern

ToolCard provides the generic frame used by tool-like surfaces: an outer card,
header, body, footer, and a convenience `ToolCardShell` composition.

Keep this pattern free of Flow Chat tool behavior. Product-specific cards,
tool-name mappings, status wording, streaming behavior, and result renderers
belong in `src/web-ui/src/flow_chat/tool-cards`.

## Components

- `ToolCard`: generic card container with status and tone attributes.
- `ToolCardHeader`: icon, title, metadata, and action area.
- `ToolCardBody`: standard content region.
- `ToolCardFooter`: footer/action region.
- `ToolCardShell`: convenience composition for common header/body/footer cards.

## Usage

```tsx
import { ToolCardShell } from '@/design-system/patterns';

<ToolCardShell
  title="Tool"
  meta="Running"
  status="running"
  tone="info"
>
  Tool output goes here.
</ToolCardShell>;
```

## Product Integration

Use this pattern as a visual shell only. Flow Chat should wrap it from
`flow_chat/tool-cards` when a card needs product data, localized status text,
height contracts, collapse events, or tool-specific result parsing.
