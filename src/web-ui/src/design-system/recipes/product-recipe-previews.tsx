/* eslint-disable react-refresh/only-export-components */
import {
  Badge,
  Button,
  CommandBar,
  DataList,
  DataListItem,
  FormActions,
  FormField,
  FormSection,
  IconButton,
  InspectorPanel,
  ListDetail,
  NavigationList,
  NavigationListItem,
  Panel,
  PanelBody,
  PanelHeader,
  Scene,
  SceneBody,
  SceneHeader,
  SearchToolbar,
  Select,
  SettingsPage,
  SettingsSection,
  StatusBar,
  Switch,
  TextField,
  ToolCard,
  ToolCardBody,
  ToolCardFooter,
  ToolCardHeader,
} from '@/design-system';
import type { PreviewCategory } from '@/design-system/types';
import {
  CheckCircle2,
  FileCode2,
  Filter,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';

const modelOptions = [
  { label: 'GPT-5.3 Codex', value: 'gpt-5.3-codex', description: 'Default coding agent model' },
  { label: 'GPT-5.3 Mini', value: 'gpt-5.3-mini', description: 'Fast review and triage model' },
];

const permissionOptions = [
  { label: 'Ask before write', value: 'ask', description: 'Recommended for shared workspaces' },
  { label: 'Allow scoped writes', value: 'scoped', description: 'Only inside the open workspace' },
];

function AgentSessionRecipePreview() {
  const list = (
    <Panel>
      <PanelHeader
        title="Session queue"
        description="Use SearchToolbar above DataList when the primary job is finding work."
      />
      <PanelBody>
        <SearchToolbar
          density="compact"
          search={{ value: 'release checks', inputAriaLabel: 'Search sessions' }}
          filters={<Button size="small" variant="secondary">Open</Button>}
          actions={<IconButton aria-label="Filter sessions" tooltip="Filter sessions" size="small"><Filter size={14} /></IconButton>}
        />
        <DataList style={{ marginTop: 12 }}>
          <DataListItem selected>
            <div className="recipe-preview-row">
              <div className="recipe-preview-row__copy">
                <p className="recipe-preview-row__title">Desktop release readiness</p>
                <p className="recipe-preview-row__meta">3 active tool calls · review required</p>
              </div>
              <Badge variant="warning">Review</Badge>
            </div>
          </DataListItem>
          <DataListItem>
            <div className="recipe-preview-row">
              <div className="recipe-preview-row__copy">
                <p className="recipe-preview-row__title">Design-system import audit</p>
                <p className="recipe-preview-row__meta">Waiting for design-system check</p>
              </div>
              <Badge variant="neutral">Queued</Badge>
            </div>
          </DataListItem>
        </DataList>
      </PanelBody>
    </Panel>
  );

  const detail = (
    <InspectorPanel
      title="Desktop release readiness"
      description="Use InspectorPanel for selected item facts, status, and local commands."
      actions={<Button size="small" variant="primary">Resume</Button>}
      footer={<StatusBar tone="warning" leading={<ShieldCheck size={14} />}>One permission decision is pending.</StatusBar>}
    >
      <div className="recipe-preview-metrics">
        <div className="recipe-preview-metric"><strong>8</strong><span>files changed</span></div>
        <div className="recipe-preview-metric"><strong>3</strong><span>checks running</span></div>
        <div className="recipe-preview-metric"><strong>1</strong><span>blocked action</span></div>
      </div>
      <div className="recipe-preview-meta" style={{ marginTop: 14 }}>
        <span>Pattern stack: Scene + ListDetail + DataList + InspectorPanel + StatusBar</span>
        <span className="recipe-preview-code-path">Workspace: D:/workspace/Sparo-Agentic-OS</span>
      </div>
    </InspectorPanel>
  );

  return (
    <Scene density="compact" className="recipe-preview-stack">
      <SceneHeader
        eyebrow="Recipe"
        title="Agent session workbench"
        description="Default shell for session triage, task continuation, and current agent activity."
        actions={(
          <CommandBar
            density="compact"
            primary={<Button variant="primary">New session</Button>}
            secondary={<Button variant="ghost">Refresh</Button>}
            meta="Live workspace"
          />
        )}
      />
      <SceneBody>
        <ListDetail listLabel="Sessions" detailLabel="Session detail" ratio="balanced" list={list} detail={detail} />
      </SceneBody>
    </Scene>
  );
}

function WorkspaceFilesRecipePreview() {
  const list = (
    <Panel>
      <PanelHeader
        title="Workspace files"
        actions={<IconButton aria-label="Refresh files" tooltip="Refresh files" size="small"><RefreshCw size={14} /></IconButton>}
      />
      <PanelBody>
        <NavigationList aria-label="Workspace file groups">
          <NavigationListItem active icon={<FolderOpen size={14} />} meta="12">src/web-ui</NavigationListItem>
          <NavigationListItem icon={<FileCode2 size={14} />} meta="4">design-system</NavigationListItem>
          <NavigationListItem icon={<GitBranch size={14} />} meta="dirty">git status</NavigationListItem>
        </NavigationList>
      </PanelBody>
    </Panel>
  );

  const detail = (
    <Panel>
      <PanelHeader
        title="File operations"
        description="Use Panel for bounded tools and keep file paths intentionally wrappable."
        actions={<Button size="small" variant="secondary">Open</Button>}
      />
      <PanelBody>
        <div className="recipe-preview-stack">
          <StatusBar tone="info" leading={<Search size={14} />}>
            Preview is deterministic: no workspace file reads or Tauri commands.
          </StatusBar>
          <DataList>
            <DataListItem selected>
              <p className="recipe-preview-row__title">Edited recipe docs</p>
              <p className="recipe-preview-row__meta recipe-preview-code-path">
                src/web-ui/src/design-system/recipes/agent-session-workbench.recipe.md
              </p>
            </DataListItem>
            <DataListItem>
              <p className="recipe-preview-row__title">Updated preview registry</p>
              <p className="recipe-preview-row__meta recipe-preview-code-path">
                src/web-ui/src/design-system/preview/registries/recipes.tsx
              </p>
            </DataListItem>
          </DataList>
        </div>
      </PanelBody>
    </Panel>
  );

  return (
    <div className="recipe-preview-narrow">
      <ListDetail listLabel="Navigation" detailLabel="File detail" ratio="narrow" list={list} detail={detail} />
    </div>
  );
}

function ModelSettingsRecipePreview() {
  return (
    <Scene density="compact" className="recipe-preview-stack">
      <SceneHeader
        eyebrow="Recipe"
        title="AI model and permission settings"
        description="Configuration screens should use SettingsPage, SettingsSection, FormSection, and FormField before primitives."
        actions={<Button variant="primary">Save changes</Button>}
      />
      <SceneBody>
        <SettingsPage>
          <SettingsSection
            title="Model defaults"
            description="Put related settings in one section and keep action placement stable."
            actions={<Badge variant="success">Synced</Badge>}
          >
            <FormSection>
              <FormField label="Default coding model" description="Used when a new agent session starts.">
                <Select options={modelOptions} value="gpt-5.3-codex" />
              </FormField>
              <FormField label="Workspace write permission" description="Use Select for policy sets instead of multiple switches.">
                <Select options={permissionOptions} value="ask" />
              </FormField>
              <FormField label="Proactive assistance" description="Use Switch for immediate binary settings only.">
                <Switch checked label="Suggest next actions after tool batches" />
              </FormField>
              <FormField
                label="Reasoning budget label"
                description="Long text must wrap without pushing actions out of reach."
                error="Use a short label that can fit compact settings navigation."
              >
                <TextField value="balanced-release-readiness-with-extra-long-local-policy-name" error />
              </FormField>
              <FormActions>
                <Button variant="ghost">Reset</Button>
                <Button variant="primary">Save</Button>
              </FormActions>
            </FormSection>
          </SettingsSection>
        </SettingsPage>
      </SceneBody>
    </Scene>
  );
}

function ToolExecutionRecipePreview() {
  return (
    <div className="recipe-preview-stack">
      <ToolCard status="running" tone="info">
        <ToolCardHeader
          icon={<Terminal size={16} />}
          title="Run web build"
          meta="Running · pnpm run check:design-system"
          actions={<IconButton aria-label="Stop command" tooltip="Stop command" size="small" variant="danger"><XCircle size={14} /></IconButton>}
        />
        <ToolCardBody>
          <div className="recipe-preview-meta">
            <span>Show the operation, status text, and stable actions while output streams.</span>
            <span className="recipe-preview-code-path">src/web-ui/dist-preview/assets/index.js</span>
          </div>
        </ToolCardBody>
        <ToolCardFooter>
          <Button size="small" variant="secondary">Open log</Button>
        </ToolCardFooter>
      </ToolCard>
      <ToolCard status="completed" tone="success">
        <ToolCardHeader icon={<CheckCircle2 size={16} />} title="Design check" meta="Completed" />
        <ToolCardBody>Use success tone only with explicit completed copy and a visible status icon.</ToolCardBody>
      </ToolCard>
      <ToolCard status="error" tone="danger">
        <ToolCardHeader icon={<Wrench size={16} />} title="Apply patch" meta="Needs attention" />
        <ToolCardBody>
          Patch failed because the context no longer matched. Show a recovery path instead of a blank error.
        </ToolCardBody>
        <ToolCardFooter>
          <Button size="small" variant="primary">Review context</Button>
        </ToolCardFooter>
      </ToolCard>
    </div>
  );
}

export const recipePreviewCategories: PreviewCategory[] = [
  {
    id: 'ds-ai-entry',
    name: 'AI Entry Rules',
    description: 'Start here before composing any product UI with the design system.',
    layoutType: 'large-card',
    tier: 'recipe',
    aiRole: 'This page is the decision layer: pick the closest recipe, then compose patterns, then place primitives inside those patterns.',
    decisionRules: [
      'For scenes, start with Scene and choose ListDetail, SettingsPage, or Panel based on the user workflow.',
      'For flow-chat tool output, start with ToolCard and keep tool-specific rendering in the product folder.',
      'For configuration, use SettingsPage and FormField before reaching for individual inputs.',
      'Do not create feature-local control APIs for buttons, inputs, selects, dialogs, tabs, badges, or tooltips.',
    ],
    examples: [
      {
        id: 'recipe-agent-session-workbench',
        name: 'Agent session workbench',
        description: 'Real product scene for session triage, task continuation, and live agent activity.',
        category: 'ds-ai-entry',
        render: AgentSessionRecipePreview,
        ai: {
          recipe: 'recipes/agent-session-workbench.recipe.md',
          useWhen: ['Building session, task, or agent activity scenes', 'The user needs list selection plus a focused detail panel'],
          composeWith: ['Scene', 'ListDetail', 'DataList', 'InspectorPanel', 'CommandBar', 'StatusBar'],
          avoid: ['Unbounded page cards', 'Feature-local list containers', 'Color-only state'],
          states: ['default', 'selected', 'loading', 'error', 'long text', 'narrow', 'theme', 'i18n'],
        },
      },
      {
        id: 'recipe-workspace-file-operations',
        name: 'Workspace file operations',
        description: 'Compact navigation plus detail shell for file, diff, and workspace browsing tasks.',
        category: 'ds-ai-entry',
        render: WorkspaceFilesRecipePreview,
        ai: {
          recipe: 'recipes/workspace-file-operations.recipe.md',
          useWhen: ['Building file browsers, diff summaries, or workspace operation panes', 'The UI has paths, counts, and selectable navigation'],
          composeWith: ['ListDetail', 'NavigationList', 'Panel', 'DataList', 'StatusBar'],
          avoid: ['Live file-system reads in preview', 'Truncation without tooltip or wrap strategy'],
          states: ['default', 'empty', 'selected', 'long text', 'narrow', 'theme'],
        },
      },
      {
        id: 'recipe-model-settings',
        name: 'Model and permission settings',
        description: 'Settings recipe for model defaults, workspace policies, and validation states.',
        category: 'ds-ai-entry',
        render: ModelSettingsRecipePreview,
        ai: {
          recipe: 'recipes/model-permission-settings.recipe.md',
          useWhen: ['Building settings, preferences, provider setup, or policy pages', 'The surface saves durable configuration'],
          composeWith: ['Scene', 'SettingsPage', 'SettingsSection', 'FormSection', 'FormField', 'Select', 'Switch'],
          avoid: ['Multiple switches for one option set', 'Save buttons that move between states'],
          states: ['default', 'disabled', 'loading', 'error', 'long text', 'narrow', 'theme', 'i18n'],
        },
      },
      {
        id: 'recipe-tool-execution',
        name: 'Tool execution cards',
        description: 'Flow-chat execution shell for running, completed, and failed tool output.',
        category: 'ds-ai-entry',
        render: ToolExecutionRecipePreview,
        ai: {
          recipe: 'recipes/tool-execution-card.recipe.md',
          useWhen: ['Rendering AI or tool execution results', 'The content streams, completes, or fails with recovery actions'],
          composeWith: ['ToolCard', 'ToolCardHeader', 'ToolCardBody', 'ToolCardFooter', 'Button', 'IconButton'],
          avoid: ['Status represented by color only', 'Action layout that shifts between running and completed states'],
          states: ['pending', 'running', 'completed', 'error', 'long text', 'theme', 'i18n'],
        },
      },
    ],
  },
];
