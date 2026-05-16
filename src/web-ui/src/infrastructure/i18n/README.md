# Frontend i18n

## Quick Start

```typescript
import { useI18n } from '@/infrastructure/i18n';

const { t } = useI18n('components');
<span>{t('section.key')}</span>
```

## Core API

### `useI18n(namespace)`

```typescript
const { t } = useI18n('components');

t('dialog.confirm.ok');
t('session.title', { id: 123 });
```

Multiple namespaces:

```typescript
const { t } = useI18n('components');
const { t: tSettings } = useI18n('settings');
```

Common returns:

```typescript
const {
  t,
  currentLanguage,
  changeLanguage,
  isReady,
  formatDate,
  formatNumber,
} = useI18n('components');
```

Non-React usage:

```typescript
import { i18nService } from '@/infrastructure/i18n';

i18nService.t('namespace:section.key');
```

## Locale Files

Path: `src/web-ui/src/locales/{zh-CN,en-US}/`

| Namespace | File | Purpose |
|----------|------|------|
| `common` | `common.json` | Shared text |
| `components` | `components.json` | UI components |
| `errors` | `errors.json` | Error messages |
| `flow-chat` | `flow-chat.json` | Backward-compatible chat keys |
| `flow-chat/*` | `flow-chat/*.json` | Chat subdomains such as input, tool cards, session, welcome, and design canvas |
| `notifications` | `notifications.json` | Notification system text |
| `panels/*` | `panels/*.json` | Panels |
| `scenes/*` | `scenes/*.json` | Scene-level UI text |
| `settings` | `settings.json` | Backward-compatible settings keys |
| `settings/*` | `settings/*.json` | Settings subpages |
| `shell/*` | `shell/*.json` | Shell, navigation, header, and remote-connect text |
| `tools` | `tools.json` | Cross-tool UI text |
| `tray` | `tray.json` | System tray text |

For namespace ownership and file placement rules, follow `src/web-ui/src/locales/AGENTS.md`.

## Add Translations

1. Add keys to both `locales/zh-CN/` and `locales/en-US/`:

```json
// locales/zh-CN/components.json
{
  "myFeature": {
    "title": "我的功能",
    "desc": "共 {{count}} 项"
  }
}

// locales/en-US/components.json
{
  "myFeature": {
    "title": "My Feature",
    "desc": "{{count}} items"
  }
}
```

2. Use in components:

```typescript
const { t } = useI18n('components');
t('myFeature.title');
t('myFeature.desc', { count: 5 });
```

## Conventions

- Namespace equals filename without `.json`; nested folders use `/`
- Keys use dot notation: `section.subsection.key`
- Interpolation uses `{{variable}}`
- Keep both languages in sync
