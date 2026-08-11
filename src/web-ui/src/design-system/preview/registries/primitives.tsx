import type { PreviewCategory } from '@/design-system/types';
import { useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DateRangeDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  DropdownMenu,
  EmptyState,
  FloatingCard,
  IconButton,
  NumberField,
  Pagination,
  Radio,
  Search as SearchField,
  SegmentedControl,
  Select,
  Skeleton,
  SqueezeSegmentedControl,
  Switch,
  TabPane,
  Tabs,
  Textarea,
  TextField,
  LoadingSkeleton,
  DividerSwitch,
  ModeSwitch,
  StatusDot,
  StatusPill,
  SPARO_ICON_OPTICAL_STROKE_WIDTH,
  SparoAgentIcon,
  SparoLogoCore,
  SparoLogoMark,
  SparoLogoMotion,
  SparoSubagentIcon,
  SparoSystemIcon,
  systemIconNames,
  type DateRangeValue,
} from '@/design-system';
import { ChevronDown, Copy, Grid3X3, List, Plus, RefreshCw, Search, Settings2, Sparkles, Trash2 } from 'lucide-react';

const agentOptions = [
  { label: 'Codex', value: 'codex', description: 'Default coding agent' },
  { label: 'Explorer', value: 'explorer', description: 'Codebase exploration' },
  { label: 'Worker', value: 'worker', description: 'Implementation task' },
];

function DialogPreview() {
  const [variant, setVariant] = useState<'default' | 'without-dividers' | null>(null);
  return (
    <div className="recipe-preview-stack">
      <div style={{ display: 'flex', gap: 'var(--ds-space-2)', flexWrap: 'wrap' }}>
        <Button size="small" onClick={() => setVariant('default')}>Open dialog</Button>
        <Button size="small" variant="secondary" onClick={() => setVariant('without-dividers')}>
          Open undivided dialog
        </Button>
      </div>
      <Dialog
        open={variant !== null}
        onOpenChange={(open) => { if (!open) setVariant(null); }}
        title="Confirm workspace action"
        size="small"
        showDividers={variant !== 'without-dividers'}
      >
        <DialogBody>
          This dialog traps focus, supports Escape, restores focus, and exposes a labelled dialog surface.
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" size="small" onClick={() => setVariant(null)}>Cancel</Button>
          <Button variant="primary" size="small" onClick={() => setVariant(null)}>Confirm</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function FloatingCardPreview() {
  const [visible, setVisible] = useState(true);

  if (!visible) {
    return <Button size="small" variant="secondary" onClick={() => setVisible(true)}>Restore card</Button>;
  }

  return (
    <div style={{ width: 'min(320px, 100%)' }}>
      <FloatingCard
        padding="compact"
        onDismiss={() => setVisible(false)}
        dismissLabel="Dismiss notification"
        dismissTooltip="Dismiss notification"
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ds-space-2)' }}>
          <Sparkles size={18} style={{ flexShrink: 0, color: 'var(--ds-color-accent-500)' }} />
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', color: 'var(--ds-color-text-primary)', fontSize: 'var(--ds-font-size-sm)' }}>
              Workspace summary is ready
            </strong>
            <span style={{ display: 'block', marginTop: 3, color: 'var(--ds-color-text-secondary)', fontSize: 'var(--ds-font-size-xs)', lineHeight: 1.45 }}>
              通知内容可以自然换行；浮卡的圆角、阴影与关闭按钮都由设计系统负责。
            </span>
          </div>
        </div>
      </FloatingCard>
    </div>
  );
}

function PopupMenuPreview() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div style={{ minHeight: 180 }}>
      <Button
        ref={anchorRef}
        size="small"
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        Session options <ChevronDown size={14} />
      </Button>
      <DropdownMenu
        open={open}
        anchorRef={anchorRef}
        align="left"
        minWidth={200}
        onClose={() => setOpen(false)}
        items={[
          { type: 'item', id: 'rename', label: 'Rename session', onClick: () => undefined },
          { type: 'item', id: 'duplicate', label: 'Duplicate session', onClick: () => undefined },
          { type: 'separator', id: 'separator' },
          { type: 'item', id: 'disabled', label: 'Unavailable action', disabled: true },
        ]}
      />
    </div>
  );
}

function DateRangeDialogPreview() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRangeValue>({
    startDate: new Date(2026, 6, 1),
    endDate: new Date(2026, 6, 8),
  });

  const rangeLabel = `${range.startDate.toLocaleDateString('en-US')} - ${range.endDate.toLocaleDateString('en-US')}`;

  return (
    <div className="recipe-preview-stack">
      <Button size="small" variant="secondary" onClick={() => setOpen(true)}>Open date range</Button>
      <small>{rangeLabel}</small>
      <DateRangeDialog
        open={open}
        onOpenChange={setOpen}
        onApply={setRange}
        title="Review date range"
        initialRange={range}
        maxDate={new Date(2026, 6, 8)}
        locale="en-US"
        labels={{
          hint: 'Click a start date, then an end date.',
          summary: (start, end) => `${start} - ${end}`,
          pickEndHint: (start) => `Now choose an end date (start: ${start}).`,
          pickEndError: 'Select an end date to complete the range.',
          previousMonth: 'Previous month',
          nextMonth: 'Next month',
          cancel: 'Cancel',
          apply: 'Apply',
        }}
      />
    </div>
  );
}

function StatefulNumberField() {
  const [value, setValue] = useState(42);
  return (
    <NumberField
      id="preview-number-field"
      label="Execution limit"
      value={value}
      min={0}
      max={100}
      unit="%"
      hint="Arrow keys adjust the value."
      onChange={setValue}
    />
  );
}

function SparoLogoMotionPreview() {
  const [startupRun, setStartupRun] = useState(0);
  const samples = [
    {
      motion: 'startup' as const,
      title: '启动 / Startup',
      note: '圆形外场从红色核心向外显现，材质与层级同步聚焦',
    },
    {
      motion: 'thinking' as const,
      title: '思考 / Thinking',
      note: '外场保持稳定，红色核心区域轻柔聚能与释放',
    },
    {
      motion: 'processing' as const,
      title: '处理 / Processing',
      note: '定向材质高光扫过圆形边界，表达持续执行',
    },
  ];

  return (
    <div className="recipe-preview-stack" style={{ minWidth: 280 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(156px, 1fr))',
          gap: 'var(--ds-space-3)',
        }}
      >
        {samples.map((sample) => (
          <div
            key={`${sample.motion}-${sample.motion === 'startup' ? startupRun : 0}`}
            style={{
              alignItems: 'center',
              background: 'var(--ds-color-bg-elevated)',
              border: '1px solid var(--ds-color-border-subtle)',
              borderRadius: 'var(--ds-radius-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--ds-space-2)',
              minWidth: 0,
              padding: 'var(--ds-space-4)',
              textAlign: 'center',
            }}
          >
            <SparoLogoMotion motion={sample.motion} size={132} label={sample.title} />
            <strong style={{ color: 'var(--ds-color-text-primary)', fontSize: 'var(--ds-font-size-sm)' }}>
              {sample.title}
            </strong>
            <span style={{ color: 'var(--ds-color-text-muted)', fontSize: 'var(--ds-font-size-xs)', lineHeight: 1.45 }}>
              {sample.note}
            </span>
          </div>
        ))}
      </div>
      <div className="recipe-preview-inline" style={{ justifyContent: 'space-between' }}>
        <Button size="small" variant="secondary" onClick={() => setStartupRun(value => value + 1)}>
          Replay startup
        </Button>
        <div className="recipe-preview-inline" aria-label="Narrow size examples">
          <SparoLogoMotion motion="thinking" size={64} decorative />
          <SparoLogoMotion motion="processing" size={88} decorative />
        </div>
      </div>
    </div>
  );
}

function StatefulNullableNumberField() {
  const [value, setValue] = useState<number | null>(null);
  return (
    <NumberField
      id="preview-nullable-number-field"
      label="空闲超时"
      value={value}
      nullable
      min={0}
      unit="秒"
      placeholder="未设置"
      hint="留空表示使用系统默认值。"
      increaseAriaLabel="增加空闲超时"
      decreaseAriaLabel="减少空闲超时"
      onChange={setValue}
    />
  );
}

function StatefulSqueezeSegmentedControl() {
  const [value, setValue] = useState('custom');
  return (
    <SqueezeSegmentedControl
      ariaLabel="Model assignment"
      value={value}
      onChange={setValue}
      options={[
        { value: 'flagship', label: '旗舰', detail: 'gpt-5-codex' },
        { value: 'fast', label: '快速', detail: 'gpt-5-mini' },
        { value: 'custom', label: '其他', detail: 'deepseek-v4-flash', trailing: <ChevronDown size={12} /> },
      ]}
    />
  );
}

function StatefulModeSwitch() {
  const [value, setValue] = useState('manual');
  return (
    <ModeSwitch
      appearance="slider"
      ariaLabel="Settings mode"
      value={value}
      onChange={setValue}
      options={[
        { value: 'manual', label: 'Manual' },
        { value: 'ai', label: 'AI' },
      ]}
    />
  );
}

export const primitivePreviewCategories: PreviewCategory[] = [
  {
    id: 'ds-primitives',
    name: 'Primitives',
    description: 'Stable low-level controls. Use them inside patterns, not as feature-local UI frameworks.',
    layoutType: 'grid-3',
    tier: 'primitive',
    aiRole: 'Primitives are leaf controls. Reach for them after a recipe and pattern already define the page structure.',
    decisionRules: [
      'Use Button for text commands and IconButton for icon-only commands with accessible labels.',
      'Use Select for option sets, Switch or Checkbox only for binary settings.',
      'Use Badge and EmptyState for state communication; never rely on color alone.',
    ],
    examples: [
      {
        id: 'ds-sparo-logo-mark',
        name: 'Sparo logo mark',
        description: 'Responsive raster brand mark derived from the approved material master.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-inline">
            <SparoLogoMark size={18} aria-label="Sparo OS" role="img" />
            <SparoLogoMark size={24} aria-label="Sparo OS" role="img" />
            <SparoLogoMark size={32} aria-label="Sparo OS" role="img" />
            <SparoLogoMark size={48} aria-label="Sparo OS" role="img" />
            <SparoLogoMark size={72} aria-label="Sparo OS" role="img" />
          </div>
        ),
        ai: {
          useWhen: ['A first-party Sparo OS surface needs the official brand mark'],
          composeWith: ['IconButton', 'Toolbar', 'DialogHeader', 'EmptyState'],
          avoid: ['Generic actions or objects that already have a Lucide icon', 'Raster copies of the brand mark'],
          states: ['default', 'theme', 'narrow'],
        },
      },
      {
        id: 'ds-sparo-logo-core',
        name: 'Sparo logo core',
        description: 'Compact source-derived red core shared with the default tray state.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-inline">
            <SparoLogoCore size={16} aria-label="Sparo OS" role="img" />
            <SparoLogoCore size={20} aria-label="Sparo OS" role="img" />
            <SparoLogoCore size={24} aria-label="Sparo OS" role="img" />
            <SparoLogoCore size={32} aria-label="Sparo OS" role="img" />
            <SparoLogoCore size={48} aria-label="Sparo OS" role="img" />
          </div>
        ),
        ai: {
          useWhen: ['Compact Sparo OS app chrome should align with the default tray identity'],
          composeWith: ['IconButton', 'Toolbar'],
          avoid: ['Application icons', 'Large identity moments', 'Replacing the full mark outside compact chrome'],
          states: ['default', 'theme', 'narrow'],
        },
      },
      {
        id: 'ds-sparo-logo-motion',
        name: 'Sparo logo motion states',
        description: 'Canonical circular material logo mapped to startup, thinking, and processing motion semantics.',
        category: 'ds-primitives',
        render: () => <SparoLogoMotionPreview />,
        ai: {
          useWhen: ['A first-party Sparo OS lifecycle moment needs a recognizable branded state animation'],
          composeWith: ['StartupScene', 'EmptyState', 'ToolCard', 'StatusBar'],
          avoid: ['Replacing ordinary inline spinners', 'Changing the circular silhouette during thinking', 'Reconstructing the logo geometry in feature code'],
          states: ['startup', 'thinking', 'processing', 'narrow', 'theme', 'i18n', 'reduced motion'],
        },
      },
      {
        id: 'ds-sparo-system-icons',
        name: 'Sparo semantic icon families',
        description: 'First-party system, work-type, panel-control, navigation, search/filter, file-transfer, and edit/manage icons sourced from the standalone @sparo/icons package.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-inline" style={{ flexWrap: 'wrap' }}>
            {systemIconNames.map((name) => (
              <SparoSystemIcon
                key={name}
                name={name}
                size={28}
                strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.regular}
                absoluteStrokeWidth
                title={name}
              />
            ))}
            <SparoAgentIcon
              size={20}
              strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
              absoluteStrokeWidth
              aria-label="Agent"
            />
            <SparoSubagentIcon
              size={20}
              strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
              absoluteStrokeWidth
              aria-label="Subagent"
            />
          </div>
        ),
        ai: {
          useWhen: ['A first-party Sparo OS destination, work type, navigation surface, or large-format semantic action needs a recognizable icon'],
          composeWith: ['Button', 'IconButton', 'DataList', 'Navigation'],
          avoid: ['Generic actions that already have a Lucide icon', 'Feature-local redraws or recolored copies'],
          states: ['default', 'theme', 'narrow'],
        },
      },
      {
        id: 'ds-button-semantics',
        name: 'Button command semantics',
        description: 'Variant, size, loading, disabled, and icon-only command rules.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-stack">
            <div className="recipe-preview-inline">
              <Button variant="primary">Save</Button>
              <Button variant="secondary">Cancel</Button>
              <Button variant="danger">Delete</Button>
              <Button variant="ai">Ask AI</Button>
            </div>
            <div className="recipe-preview-inline">
              <Button size="small">Small</Button>
              <Button size="medium">Medium</Button>
              <Button size="large">Large</Button>
              <Button isLoading>Loading</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="recipe-preview-inline">
              <IconButton aria-label="Copy result" tooltip="Copy result" size="small"><Copy size={14} /></IconButton>
              <IconButton aria-label="Refresh" tooltip="Refresh" size="small"><RefreshCw size={14} /></IconButton>
              <IconButton aria-label="Open full reading" tooltip="Open full reading" size="small" shape="circle" variant="primary"><Sparkles size={14} /></IconButton>
              <IconButton aria-label="Advance intent" tooltip="Advance intent" size="small" shape="circle" variant="brand"><Sparkles size={14} /></IconButton>
              <IconButton aria-label="Create task" tooltip="Create task" size="small" shape="circle" variant="accent"><Plus size={14} /></IconButton>
              <IconButton aria-label="Delete" tooltip="Delete" size="small" variant="danger"><Trash2 size={14} /></IconButton>
            </div>
          </div>
        ),
        ai: {
          useWhen: ['The action is a command, confirmation, or toolbar affordance'],
          composeWith: ['Toolbar', 'CommandBar', 'PanelHeader', 'ToolCardFooter'],
          avoid: ['Custom button classes in feature SCSS', 'Text inside icon-only controls', 'Ad hoc product accent colors outside IconButton variants'],
          states: ['default', 'disabled', 'loading', 'focus', 'long text', 'theme', 'i18n'],
        },
      },
      {
        id: 'ds-floating-card',
        name: 'Floating card',
        description: 'Large-radius non-modal surface with a pronounced two-stage elevation shadow and a standard circular dismiss command.',
        category: 'ds-primitives',
        render: () => <FloatingCardPreview />,
        ai: {
          useWhen: ['A transient notification, anchored helper, or compact popup needs a lightweight surface'],
          composeWith: ['FloatingCardAction', 'Button', 'StatusDot', 'Badge'],
          avoid: ['Modal workflows', 'Feature-local radius, shadow, background, or close-button styling'],
          states: ['default', 'focused', 'long text', 'narrow', 'theme', 'i18n'],
        },
      },
      {
        id: 'ds-popup-menu',
        name: 'Popup menu',
        description: 'Anchored menu baseline with the shared floating shadow and an intermediate xl corner radius.',
        category: 'ds-primitives',
        render: () => <PopupMenuPreview />,
        ai: {
          useWhen: ['A command trigger opens a compact anchored menu or a richer composed menu surface'],
          composeWith: ['DropdownMenu', 'PopupMenu', 'Button', 'IconButton', 'SelectableRow'],
          avoid: ['Feature-local popup backgrounds, borders, radii, shadows, or entry motion'],
          states: ['default', 'open', 'disabled', 'focused', 'long text', 'narrow', 'theme', 'i18n'],
        },
      },
      {
        id: 'ds-form-controls',
        name: 'Form controls',
        description: 'Text, select, switch, and checkbox primitives in realistic settings copy.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-stack" style={{ minWidth: 260 }}>
            <TextField
              label="Workspace name"
              description="Human-readable project label."
              placeholder="Sparo Agentic OS"
            />
            <Select
              options={agentOptions}
              placeholder="Choose an agent"
              searchable
              shape="pill"
              dropdownWidth="min(320px, calc(100vw - 32px))"
            />
            <Switch label="Enable proactive assistance" description="Suggest the next action after a tool batch." />
            <Radio
              name="preview-default-agent"
              label="Use default agent"
              description="Radio covers mutually exclusive single-choice rows."
              defaultChecked
            />
            <Checkbox label="Allow workspace file edits" />
          </div>
        ),
        ai: {
          useWhen: ['A pattern needs a compact, accessible form control'],
          composeWith: ['FormField', 'FormSection', 'SettingsSection', 'SearchToolbar'],
          avoid: ['Unlabeled controls', 'Multiple switches for one option set'],
          states: ['default', 'disabled', 'loading', 'error', 'long text', 'narrow', 'i18n'],
        },
      },
      {
        id: 'ds-feedback',
        name: 'Feedback primitives',
        description: 'Status badges and empty states for desktop workflow surfaces.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-stack">
            <div className="recipe-preview-inline">
              <Badge variant="neutral">Default</Badge>
              <Badge variant="success">Ready</Badge>
              <Badge variant="warning">Needs review</Badge>
              <Badge variant="error">Blocked</Badge>
            </div>
            <EmptyState description="No matching sessions" imageSize="small">
              <Button variant="secondary" size="small">Create one</Button>
            </EmptyState>
          </div>
        ),
        ai: {
          useWhen: ['A list, panel, or tool surface has no data or has a concise status'],
          composeWith: ['PanelBody', 'DataListEmpty', 'EmptyStatePanel', 'StatusBar'],
          avoid: ['Color-only status', 'Blank panels for empty data'],
          states: ['default', 'empty', 'error', 'long text', 'theme', 'i18n'],
        },
      },
      {
        id: 'ds-search-and-filters',
        name: 'Search affordances',
        description: 'Search iconography and filter commands for compact desktop surfaces.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-stack" style={{ minWidth: 280 }}>
            <TextField prefix={<Search size={14} />} placeholder="Search sessions, paths, or tools" />
            <div className="recipe-preview-inline">
              <IconButton aria-label="Tune filters" tooltip="Tune filters" size="small">
                <Settings2 size={14} />
              </IconButton>
              <Button size="small" variant="secondary">Active filters</Button>
            </div>
          </div>
        ),
        ai: {
          useWhen: ['A local surface needs a small search or filter entry point'],
          composeWith: ['SearchToolbar', 'FilterBar', 'ToolbarGroup'],
          avoid: ['Search inputs without labels or aria-labels', 'Filter chips that resize the toolbar unpredictably'],
          states: ['default', 'focused', 'empty', 'long text', 'narrow'],
        },
      },
      {
        id: 'ds-dialog-tabs-alerts',
        name: 'Dialogs, tabs, and alerts',
        description: 'Keyboard-focused primitives with explicit roles, labels, and recovery states.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-stack" style={{ minWidth: 300 }}>
            <Alert type="warning" title="Pending review" message="A permission decision needs attention." closable />
            <Tabs defaultActiveKey="summary">
              <TabPane tabKey="summary" label="Summary">Focusable tab panel content.</TabPane>
              <TabPane tabKey="details" label="Details">Arrow keys move between tabs.</TabPane>
            </Tabs>
            <DialogPreview />
            <DateRangeDialogPreview />
          </div>
        ),
        ai: {
          useWhen: ['A surface needs modal focus, tabbed content, or persistent status feedback'],
          composeWith: ['Dialog', 'Tabs', 'Alert', 'Button', 'IconButton'],
          avoid: ['Clickable div tabs', 'Dialogs without labelled titles', 'Closable alerts without button labels'],
          states: ['default', 'focused', 'error', 'long text', 'narrow', 'keyboard'],
        },
      },
      {
        id: 'ds-input-variants',
        name: 'Input variants',
        description: 'Textarea, search, and number field states with labelled controls and descriptions.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-stack" style={{ minWidth: 300 }}>
            <SearchField inputAriaLabel="Search preview examples" placeholder="Search preview examples" />
            <SearchField shape="pill" inputAriaLabel="Search preview examples pill" placeholder="Search preview examples" />
            <Textarea label="Release note" hint="Keep it short and actionable." showCount maxLength={140} />
            <StatefulNumberField />
            <StatefulNullableNumberField />
          </div>
        ),
        ai: {
          useWhen: ['A workflow needs text entry, numeric tuning, or local search'],
          composeWith: ['FormField', 'SettingsSection', 'SearchToolbar'],
          avoid: ['Unlabelled inputs', 'Hint text not connected with aria-describedby'],
          states: ['default', 'empty', 'error', 'disabled', 'long text', 'narrow', 'i18n'],
        },
      },
      {
        id: 'ds-segmented-pagination',
        name: 'Segmented control and pagination',
        description: 'Middle-layer navigation controls with selected, disabled, focused, narrow, and long-label states.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-stack" style={{ minWidth: 300 }}>
            <SegmentedControl
              ariaLabel="Preview layout"
              defaultValue="list"
              stretch
              options={[
                { value: 'list', label: 'List', icon: <List size={14} /> },
                { value: 'grid', label: 'Grid', icon: <Grid3X3 size={14} /> },
                { value: 'timeline', label: 'Timeline view with long label' },
                { value: 'disabled', label: 'Disabled', disabled: true },
              ]}
            />
            <SegmentedControl
              ariaLabel="Disabled preview layout"
              defaultValue="list"
              disabled
              options={[
                { value: 'list', label: '列表' },
                { value: 'grid', label: '网格视图' },
              ]}
            />
            <SegmentedControl
              ariaLabel="Accent mode switch"
              defaultValue="direct"
              size="small"
              variant="accent"
              options={[
                { value: 'direct', label: 'I choose' },
                { value: 'delegate', label: 'Delegate to OS' },
              ]}
            />
            <DividerSwitch
              ariaLabel="Primary tabs"
              size="medium"
              stretch
              value="network"
              options={[
                { value: 'network', label: 'Network' },
                { value: 'bot', label: 'Bot' },
              ]}
            />
            <DividerSwitch
              ariaLabel="Secondary tabs"
              value="lan"
              options={[
                { value: 'lan', label: 'LAN' },
                { value: 'ngrok', label: 'Ngrok' },
                { value: 'custom', label: 'Custom server with long label' },
              ]}
            />
            <ModeSwitch
              ariaLabel="Scene mode"
              value="discover"
              options={[
                { value: 'discover', label: 'Discover' },
                { value: 'manage', label: 'Manage' },
              ]}
            />
            <StatefulModeSwitch />
            <StatefulSqueezeSegmentedControl />
            <Pagination page={4} pageCount={12} />
            <div style={{ maxWidth: 190 }}>
              <Pagination page={2} pageCount={8} compact label="Compact pagination" />
            </div>
          </div>
        ),
        ai: {
          useWhen: ['A surface switches between small mutually exclusive modes or pages through local data'],
          composeWith: ['Toolbar', 'PanelHeader', 'DataList', 'ActionListRow'],
          avoid: ['Tabs for tiny view-mode switches', 'Pagination without a current page summary'],
          states: ['default', 'disabled', 'selected', 'focused', 'long text', 'narrow', 'i18n'],
        },
      },
      {
        id: 'ds-loading-status',
        name: 'Loading and status primitives',
        description: 'Stable loading placeholders plus text-backed state indicators.',
        category: 'ds-primitives',
        render: () => (
          <div className="recipe-preview-stack" style={{ minWidth: 280 }}>
            <div className="recipe-preview-inline">
              <StatusPill tone="success">Ready</StatusPill>
              <StatusPill tone="warning">Needs review</StatusPill>
              <StatusPill tone="error">Blocked</StatusPill>
              <StatusPill tone="info">同步中</StatusPill>
            </div>
            <div className="recipe-preview-inline">
              <StatusDot tone="accent" pulse label="Running" />
              <StatusDot tone="neutral" label="Idle" />
              <StatusPill tone="accent">Extremely-long-status-token-without-natural-breaks</StatusPill>
            </div>
            <LoadingSkeleton avatar lines={3} />
            <div style={{ maxWidth: 180 }}>
              <LoadingSkeleton compact lines={2} />
            </div>
            <Skeleton variant="block" height={40} />
          </div>
        ),
        ai: {
          useWhen: ['A panel waits for data or needs compact state communication'],
          composeWith: ['ActionListRow', 'ToolCard', 'StatusBar', 'PanelBody'],
          avoid: ['Color-only state', 'Skeletons that change layout size when content loads'],
          states: ['default', 'loading', 'error', 'long text', 'narrow', 'theme', 'i18n'],
        },
      },
    ],
  },
];
