import type { PreviewCategory } from '@/design-system/types';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DateRangeDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
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
  type DateRangeValue,
} from '@/design-system';
import { ChevronDown, Copy, Grid3X3, List, Plus, RefreshCw, Search, Settings2, Sparkles, Trash2 } from 'lucide-react';

const agentOptions = [
  { label: 'Codex', value: 'codex', description: 'Default coding agent' },
  { label: 'Explorer', value: 'explorer', description: 'Codebase exploration' },
  { label: 'Worker', value: 'worker', description: 'Implementation task' },
];

function DialogPreview() {
  const [open, setOpen] = useState(false);
  return (
    <div className="recipe-preview-stack">
      <Button size="small" onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Confirm workspace action" size="small">
        <DialogBody>
          This dialog traps focus, supports Escape, restores focus, and exposes a labelled dialog surface.
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" size="small" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" size="small" onClick={() => setOpen(false)}>Confirm</Button>
        </DialogFooter>
      </Dialog>
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
            <Select options={agentOptions} placeholder="Choose an agent" searchable />
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
          </div>
        ),
        ai: {
          useWhen: ['A workflow needs text entry, numeric tuning, or local search'],
          composeWith: ['FormField', 'SettingsSection', 'SearchToolbar'],
          avoid: ['Unlabelled inputs', 'Hint text not connected with aria-describedby'],
          states: ['default', 'error', 'disabled', 'long text', 'narrow', 'i18n'],
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
