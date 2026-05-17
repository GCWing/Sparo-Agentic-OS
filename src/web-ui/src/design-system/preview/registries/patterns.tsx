import type { PreviewCategory } from '@/design-system/types';
import {
  ActionListRow,
  Badge,
  Button,
  CommandBar,
  DataList,
  DataListEmpty,
  DataListItem,
  EmptyStatePanel,
  FormActions,
  FormField,
  FormSection,
  InspectorPanel,
  ItemCard,
  ItemCardActions,
  ItemCardMeta,
  ItemCardMetaItem,
  ItemCardMetaSeparator,
  ItemCardTitle,
  ItemCardTop,
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
  SelectableRow,
  Select,
  SettingsPage,
  SettingsSection,
  StatusBar,
  StatusPill,
  Switch,
  TextField,
  ToolCard,
  ToolCardBody,
  ToolCardFooter,
  ToolCardHeader,
} from '@/design-system';
import { ArrowRight, Bot, Clock, FileCode2, FolderOpen, GitBranch, MoreHorizontal, Search, Square, Terminal } from 'lucide-react';

export const patternPreviewCategories: PreviewCategory[] = [
  {
    id: 'ds-patterns',
    name: 'Patterns',
    description: 'Page and workflow structures that AI agents should prefer before reaching for primitives.',
    layoutType: 'large-card',
    tier: 'pattern',
    aiRole: 'Patterns define the desktop product structure: scenes, panels, lists, settings sections, and tool execution shells.',
    decisionRules: [
      'Use Scene for app pages and product scenes.',
      'Use Panel for bounded functional areas; keep cards for repeated items, dialogs, or framed tools.',
      'Use ListDetail when selection drives a focused detail surface.',
      'Use ToolCard only for AI/tool execution output and preserve streaming behavior in product code.',
    ],
    examples: [
      {
        id: 'ds-scene-panel',
        name: 'Scene + Panel',
        description: 'Default desktop scene composition with command grouping and bounded work areas.',
        category: 'ds-patterns',
        render: () => (
          <Scene style={{ minHeight: 420 }}>
            <SceneHeader
              title="Agent sessions"
              description="Dense desktop layout with clear commands and scannable panels."
              actions={(
                <CommandBar
                  density="compact"
                  primary={<Button variant="primary">New session</Button>}
                  secondary={<Button variant="secondary">Filter</Button>}
                  meta="4 active"
                />
              )}
            />
            <SceneBody>
              <Panel>
                <PanelHeader
                  title="Recent activity"
                  description="PanelHeader holds title, summary, and local actions."
                />
                <PanelBody>
                  <DataList>
                    <DataListItem selected>Refine task detail navigation</DataListItem>
                    <DataListItem>Audit design-system imports</DataListItem>
                    <DataListItem>Prepare desktop release checks</DataListItem>
                  </DataList>
                </PanelBody>
              </Panel>
            </SceneBody>
          </Scene>
        ),
        ai: {
          recipe: 'recipes/scene-page.recipe.md',
          useWhen: ['Building an app scene or durable product page'],
          composeWith: ['SceneHeader', 'SceneBody', 'Panel', 'PanelHeader', 'CommandBar'],
          avoid: ['Marketing hero layouts inside the desktop app', 'Page sections styled as floating cards'],
          states: ['default', 'loading', 'error', 'long text', 'narrow', 'theme', 'i18n'],
        },
      },
      {
        id: 'ds-list-detail',
        name: 'List detail workflow',
        description: 'Selectable master list plus focused detail or inspector surface.',
        category: 'ds-patterns',
        render: () => (
          <ListDetail
            ratio="balanced"
            listLabel="Agent runs"
            detailLabel="Selected run"
            list={(
              <Panel>
                <PanelHeader title="Runs" />
                <PanelBody>
                  <SearchToolbar
                    density="compact"
                    search={{ value: 'design', inputAriaLabel: 'Search runs' }}
                  />
                  <DataList style={{ marginTop: 12 }}>
                    <DataListItem selected>Design-system final pass</DataListItem>
                    <DataListItem>Workspace file review</DataListItem>
                    <DataListEmpty>No archived sessions match the filter.</DataListEmpty>
                  </DataList>
                </PanelBody>
              </Panel>
            )}
            detail={(
              <InspectorPanel
                title="Design-system final pass"
                description="InspectorPanel keeps selected-item facts and actions close to the content."
                footer={<StatusBar tone="info">Selection state is explicit and keyboard reachable.</StatusBar>}
              >
                <div className="recipe-preview-meta">
                  <span>Pattern stack: ListDetail + Panel + DataList + InspectorPanel.</span>
                  <span className="recipe-preview-code-path">src/web-ui/src/design-system/preview/registries/patterns.tsx</span>
                </div>
              </InspectorPanel>
            )}
          />
        ),
        ai: {
          recipe: 'recipes/list-detail.recipe.md',
          useWhen: ['Selection controls the main detail area', 'The user compares many items and acts on one'],
          composeWith: ['SearchToolbar', 'DataList', 'InspectorPanel', 'StatusBar', 'EmptyStatePanel'],
          avoid: ['Blank detail panes', 'Nested cards around list rows'],
          states: ['default', 'empty', 'selected', 'loading', 'error', 'long text', 'narrow'],
        },
      },
      {
        id: 'ds-settings-page',
        name: 'Settings page',
        description: 'Standard configuration layout for settings, preferences, and provider setup.',
        category: 'ds-patterns',
        render: () => (
          <SettingsPage>
            <SettingsSection title="Model defaults" description="Reusable form layout for preference pages.">
              <FormSection>
                <FormField label="Default model" description="Used for new coding sessions.">
                  <Select
                    value="gpt-5.3-codex"
                    options={[{ label: 'GPT-5.3 Codex', value: 'gpt-5.3-codex' }]}
                  />
                </FormField>
                <FormField label="Reasoning effort">
                  <TextField placeholder="medium" />
                </FormField>
                <FormField label="Planner mode">
                  <Switch label="Ask before making broad changes" checked readOnly />
                </FormField>
                <FormActions>
                  <Button variant="ghost">Reset</Button>
                  <Button variant="primary">Save</Button>
                </FormActions>
              </FormSection>
            </SettingsSection>
          </SettingsPage>
        ),
        ai: {
          recipe: 'recipes/settings-page.recipe.md',
          useWhen: ['The UI saves durable settings or provider configuration'],
          composeWith: ['SettingsSection', 'FormSection', 'FormField', 'Select', 'Switch', 'FormActions'],
          avoid: ['Feature-local form rows', 'Switches for multi-option policy choices'],
          states: ['default', 'disabled', 'loading', 'error', 'long text', 'narrow', 'theme', 'i18n'],
        },
      },
      {
        id: 'ds-item-card',
        name: 'Item cards',
        description: 'Reusable repeated-item card shell for tasks, apps, and other actionable catalog entries.',
        category: 'ds-patterns',
        render: () => (
          <div className="recipe-preview-stack" style={{ minWidth: 320 }}>
            <ItemCard status="running" highlighted aria-label="Running coding task">
              <ItemCardTop>
                <Bot size={14} />
                <ItemCardTitle>Refactor session card shell</ItemCardTitle>
              </ItemCardTop>
              <ItemCardMeta>
                <Badge variant="accent">Coding</Badge>
                <ItemCardMetaSeparator />
                <ItemCardMetaItem><Clock size={10} /> 2 min ago</ItemCardMetaItem>
              </ItemCardMeta>
              <ItemCardActions>
                <Button size="small" variant="ghost">Open <ArrowRight size={12} /></Button>
                <Button size="small" variant="ghost" iconOnly aria-label="Stop"><Square size={12} /></Button>
              </ItemCardActions>
            </ItemCard>
            <ItemCard status="idle" aria-label="Long catalog entry">
              <ItemCardTop>
                <FolderOpen size={14} />
                <ItemCardTitle>Extremely-long-application-name-without-breakpoints-for-overflow-checking</ItemCardTitle>
                <Badge variant="purple">Agent App</Badge>
              </ItemCardTop>
              <ItemCardMeta>
                <ItemCardMetaItem>A compact card for repeated management grids and task boards.</ItemCardMetaItem>
              </ItemCardMeta>
            </ItemCard>
          </div>
        ),
        ai: {
          useWhen: ['A repeated card represents an app, task, session, or catalog item with actions'],
          composeWith: ['Badge', 'StatusDot', 'Button', 'IconButton', 'Tooltip'],
          avoid: ['Feature-local card shells', 'Status indicated only by color', 'Nested cards'],
          states: ['default', 'running', 'active', 'error', 'long text', 'selected', 'theme', 'i18n'],
        },
      },
      {
        id: 'ds-tool-card',
        name: 'Tool card shell',
        description: 'Execution card structure for AI and tool events.',
        category: 'ds-patterns',
        render: () => (
          <div className="recipe-preview-stack">
            <ToolCard status="running" tone="info">
              <ToolCardHeader
                icon={<Terminal size={16} />}
                title="Search workspace"
                meta="Running"
                actions={<Button size="small" variant="ghost">Cancel</Button>}
              />
              <ToolCardBody>Searching for matching design-system imports across the Web UI.</ToolCardBody>
              <ToolCardFooter>
                <Button size="small" variant="secondary">Open results</Button>
              </ToolCardFooter>
            </ToolCard>
            <ToolCard status="completed" tone="success">
              <ToolCardHeader icon={<Bot size={16} />} title="Plan updated" meta="Completed" />
              <ToolCardBody>Completed status uses text, structure, and iconography together.</ToolCardBody>
            </ToolCard>
          </div>
        ),
        ai: {
          recipe: 'recipes/tool-card.recipe.md',
          useWhen: ['Rendering tool execution, streamed output, or recoverable failure states'],
          composeWith: ['ToolCardHeader', 'ToolCardBody', 'ToolCardFooter', 'Button', 'IconButton'],
          avoid: ['Status color without text', 'Changing action layout while a tool streams'],
          states: ['pending', 'running', 'completed', 'error', 'long text', 'theme', 'i18n'],
        },
      },
      {
        id: 'ds-navigation-empty-status',
        name: 'Navigation, empty, and status',
        description: 'Supporting patterns for workspace navigation and resilient empty states.',
        category: 'ds-patterns',
        render: () => (
          <div className="recipe-preview-stack">
            <NavigationList aria-label="Design-system areas">
              <NavigationListItem active icon={<FolderOpen size={14} />} meta={<Badge variant="success">Ready</Badge>}>
                Preview
              </NavigationListItem>
              <NavigationListItem icon={<FileCode2 size={14} />} meta="4">
                Recipes
              </NavigationListItem>
              <NavigationListItem icon={<Search size={14} />} meta="8">
                Status states
              </NavigationListItem>
            </NavigationList>
            <NavigationList variant="plain" aria-label="Plain workspace navigation">
              <NavigationListItem active icon={<FolderOpen size={14} />} meta="12">
                Source files
              </NavigationListItem>
              <NavigationListItem icon={<FileCode2 size={14} />} meta="4">
                Open editors
              </NavigationListItem>
              <NavigationListItem icon={<GitBranch size={14} />} meta="dirty">
                Git changes
              </NavigationListItem>
            </NavigationList>
            <EmptyStatePanel
              title="No matching tools"
              description="Use EmptyStatePanel when a bounded work area has no data."
              emptyState={{
                title: 'Nothing to show',
                description: 'Adjust filters or create a new session.',
                actions: <Button size="small" variant="primary">Create session</Button>,
              }}
            />
          </div>
        ),
        ai: {
          useWhen: ['A sidebar, local nav, or bounded panel can be empty'],
          composeWith: ['NavigationList', 'NavigationListItem', 'EmptyStatePanel', 'StatusBar', 'Badge'],
          avoid: ['Silent empty surfaces', 'Navigation state represented only by color'],
          states: ['default', 'empty', 'selected', 'long text', 'narrow', 'theme'],
        },
      },
      {
        id: 'ds-action-list-row',
        name: 'Action list rows',
        description: 'Reusable row composition for selectable items, row metadata, status, actions, loading, and errors.',
        category: 'ds-patterns',
        render: () => (
          <div className="recipe-preview-stack" style={{ minWidth: 320 }}>
            <ActionListRow
              leading={<GitBranch size={16} />}
              title="Prepare design-system migration"
              description="Row content wraps naturally and keeps action controls aligned."
              meta={<StatusPill tone="success">Ready</StatusPill>}
              actions={<Button size="small" variant="secondary">Open</Button>}
            />
            <ActionListRow
              leading={<Terminal size={16} />}
              title="Extremely-long-action-row-title-without-natural-breakpoints-to-prove-overflow-resilience"
              description="A natural long sentence can wrap across multiple lines in a narrow panel without covering metadata or actions."
              meta="12 minutes ago"
              actions={<Button size="small" variant="ghost" iconOnly aria-label="More actions"><MoreHorizontal size={14} /></Button>}
            />
            <ActionListRow
              title="Workspace permission"
              description="Disabled state preserves text contrast while blocking row-level affordances."
              meta={<StatusPill tone="warning">Waiting</StatusPill>}
              disabled
            />
            <ActionListRow
              title="Load workspace sessions"
              description="The row can mark async work without changing its dimensions."
              loading
              meta={<StatusPill tone="info">Loading</StatusPill>}
            />
            <ActionListRow
              title="Provider health check"
              description="Errors use text plus border treatment."
              error="Request failed. Check provider configuration."
              meta={<StatusPill tone="error">Error</StatusPill>}
            />
            <SelectableRow
              selected
              leading={<Bot size={16} />}
              title="Selected coding agent"
              description="SelectableRow exposes pressed state and keyboard activation through a real button."
              meta="Active"
            />
            <SelectableRow
              disabled
              title="Unavailable agent profile"
              description="Disabled selectable rows keep their layout stable."
              meta="Disabled"
            />
          </div>
        ),
        ai: {
          useWhen: ['A list row combines title, metadata, status, and row-level commands'],
          composeWith: ['DataList', 'PanelBody', 'StatusPill', 'Button', 'IconButton'],
          avoid: ['Feature-local row shells', 'Rows that rely on color only for selected or error state'],
          states: ['default', 'disabled', 'loading', 'error', 'long text', 'narrow', 'theme', 'i18n'],
        },
      },
    ],
  },
];
