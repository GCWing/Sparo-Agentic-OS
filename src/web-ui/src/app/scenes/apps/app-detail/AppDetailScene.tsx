import React, { useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  ChevronRight,
  Download,
  GitFork,
  History,
  LayoutDashboard,
  PencilLine,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
  ShieldCheck,
  Sprout,
  Square,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  EmptyState,
  IconButton,
  StatusDot,
  Tag,
  type StatusTone,
} from '@/design-system';
import type {
  AppAuthor,
  AppComponentRef,
  AppManagementAction,
  ComponentDefinition,
  NativeAppCatalogEntry,
  ProductAppCatalogEntry,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { getCatalogAppLaunchBehavior } from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import { nativeAppWorkRef, productAppWorkRef, sameAppRef, sameProductAppRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkRecord, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import { AppIcon } from '../AppIcon';
import type { AppDetailKind } from '../appsStore';
import './AppDetailScene.scss';

type ProductAppComponent = {
  ref: AppComponentRef;
  component: ComponentDefinition | null;
};

type AppDetailSection = 'overview' | 'work' | 'customize' | 'control';

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface AppDetailSceneProps {
  appKind: AppDetailKind;
  app: ProductAppCatalogEntry | NativeAppCatalogEntry;
  components: ProductAppComponent[];
  works: WorkRecord[];
  onBack: () => void;
  onLaunch: () => void;
  onStop: () => void;
  running: boolean;
  stopping: boolean;
  onOpenWork: (work: WorkRecord) => void;
  onOpenComponent: (componentId: string) => void;
  managing: boolean;
  onInstall: () => void;
  onCustomize: () => void;
  onRollback: () => void;
  onSyncUpstream: () => void;
}

interface DetailFact {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  hidden?: boolean;
}

type ComponentGraphEdgeKind = 'appComposition' | 'componentDependency';
type ComponentGraphViewMode = 'all' | 'composition' | 'dependencies' | 'permissions' | 'unresolved';

interface ComponentGraphNode {
  key: string;
  ref: AppComponentRef;
  component: ComponentDefinition | null;
  direct: boolean;
}

interface ComponentGraphEdge {
  key: string;
  fromKey: 'app' | string;
  toKey: string;
  label: string;
  kind: ComponentGraphEdgeKind;
  capabilities: string[];
}

interface ComponentGraphModel {
  nodes: ComponentGraphNode[];
  edges: ComponentGraphEdge[];
  directCount: number;
  dependencyCount: number;
  unresolvedCount: number;
}

interface ComponentGraphRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ComponentGraphLayoutNode extends ComponentGraphNode, ComponentGraphRect {
  layer: number;
}

interface ComponentGraphLayoutEdge extends ComponentGraphEdge {
  path: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface ComponentGraphLayout {
  root: ComponentGraphRect;
  nodes: ComponentGraphLayoutNode[];
  edges: ComponentGraphLayoutEdge[];
  width: number;
  height: number;
}

const COMPONENT_GRAPH_VIEW_MODES: ComponentGraphViewMode[] = [
  'all',
  'composition',
  'dependencies',
  'permissions',
  'unresolved',
];

const GRAPH_NODE_WIDTH = 300;
const GRAPH_NODE_HEIGHT = 128;
const GRAPH_LAYER_GAP = 220;
const GRAPH_ROW_GAP = 30;
const GRAPH_PADDING_X = 36;
const GRAPH_PADDING_Y = 32;
const GRAPH_ROOT_GAP = 58;

function workReferencesApp(
  work: WorkRecord,
  app: ProductAppCatalogEntry | NativeAppCatalogEntry,
  appKind: AppDetailKind,
): boolean {
  if (appKind === 'native') {
    const appRef = nativeAppWorkRef((app as NativeAppCatalogEntry).id);
    return (work.subject.kind === 'app' && sameAppRef(work.subject.app, appRef))
      || work.appRefs.some((relation) => sameAppRef(relation.app, appRef));
  }

  const productApp = app as ProductAppCatalogEntry;
  const appRef = productAppWorkRef(productApp);
  return (work.subject.kind === 'app' && sameProductAppRef(work.subject.app, appRef))
    || work.appRefs.some((relation) => sameProductAppRef(relation.app, appRef));
}

function permissionEntries(
  app: ProductAppCatalogEntry | NativeAppCatalogEntry,
): Array<{ key: keyof ProductAppCatalogEntry['permissions']; enabled: boolean }> {
  return (['fs', 'net', 'shell', 'gui', 'secrets', 'ai'] as const).map((key) => ({
    key,
    enabled: Boolean(app.permissions?.[key]),
  }));
}

function visibleAuthors(authors?: AppAuthor[] | null): AppAuthor[] {
  return (authors ?? []).filter((author) => author.name.trim().length > 0);
}

function renderAuthorList(authors: AppAuthor[]): React.ReactNode {
  return authors.map((author, index) => (
    <React.Fragment key={`${author.name}-${author.url ?? index}`}>
      {index > 0 ? ', ' : null}
      {author.url ? (
        <a href={author.url} target="_blank" rel="noreferrer">
          {author.name}
        </a>
      ) : (
        author.name
      )}
    </React.Fragment>
  ));
}

function hasManagementAction(app: ProductAppCatalogEntry, action: AppManagementAction): boolean {
  return app.management?.actions?.includes(action) === true;
}

function workStatusTone(status: WorkStatus): StatusTone {
  if (status === 'running') return 'success';
  if (status === 'waiting_user' || status === 'blocked') return 'warning';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'error';
  if (status === 'completed') return 'info';
  return 'neutral';
}

function relativeTimeLabel(timestamp: number): string {
  const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diffMinutes = Math.round((timestamp - Date.now()) / 60000);
  if (Math.abs(diffMinutes) < 60) return relativeFormatter.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeFormatter.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return relativeFormatter.format(diffDays, 'day');
}

function formatTimestamp(value?: number | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function componentRefKey(ref: AppComponentRef): string {
  return `${ref.kind}:${ref.source}:${ref.componentId}:${ref.version ?? ''}`;
}

function sameComponentRef(left: AppComponentRef, right: AppComponentRef): boolean {
  return left.componentId === right.componentId
    && left.kind === right.kind
    && left.source === right.source
    && (left.version ?? null) === (right.version ?? null);
}

function componentGraphNodeName(node: ComponentGraphNode): string {
  return node.component?.name || node.ref.componentId;
}

function buildComponentGraph(
  app: ProductAppCatalogEntry | null,
  components: ProductAppComponent[],
): ComponentGraphModel {
  if (!app) {
    return {
      nodes: [],
      edges: [],
      directCount: 0,
      dependencyCount: 0,
      unresolvedCount: 0,
    };
  }

  const directComponentRefs = app.components ?? [];
  const nodes = new Map<string, ComponentGraphNode>();
  const edges = new Map<string, ComponentGraphEdge>();

  const resolveComponentForRef = (ref: AppComponentRef): ComponentDefinition | null => {
    const directMatch = components.find((candidate) => sameComponentRef(candidate.ref, ref));
    if (directMatch) return directMatch.component;
    return components.find((candidate) => (
      candidate.component?.id === ref.componentId
      && candidate.component.kind === ref.kind
    ))?.component ?? null;
  };

  const ensureNode = (ref: AppComponentRef, direct: boolean): ComponentGraphNode => {
    const key = componentRefKey(ref);
    const existing = nodes.get(key);
    if (existing) {
      if (direct && !existing.direct) existing.direct = true;
      if (!existing.component) existing.component = resolveComponentForRef(ref);
      return existing;
    }

    const node: ComponentGraphNode = {
      key,
      ref,
      component: resolveComponentForRef(ref),
      direct,
    };
    nodes.set(key, node);
    return node;
  };

  const queue: ComponentGraphNode[] = [];
  directComponentRefs.forEach((ref) => {
    const node = ensureNode(ref, true);
    queue.push(node);
    const edgeKey = `app->${node.key}:${ref.role}`;
    edges.set(edgeKey, {
      key: edgeKey,
      fromKey: 'app',
      toKey: node.key,
      label: ref.role,
      kind: 'appComposition',
      capabilities: ref.capabilities ?? [],
    });
  });

  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    const dependencies = node.component?.dependencies ?? [];
    for (const dependencyRef of dependencies) {
      const dependencyNode = ensureNode(dependencyRef, false);
      if (!queue.some((queued) => queued.key === dependencyNode.key)) {
        queue.push(dependencyNode);
      }
      const edgeKey = `${node.key}->${dependencyNode.key}:${dependencyRef.role}`;
      edges.set(edgeKey, {
        key: edgeKey,
        fromKey: node.key,
        toKey: dependencyNode.key,
        label: dependencyRef.role,
        kind: 'componentDependency',
        capabilities: dependencyRef.capabilities ?? [],
      });
    }
  }

  const graphNodes = Array.from(nodes.values()).sort((left, right) => {
    if (left.direct !== right.direct) return left.direct ? -1 : 1;
    return componentGraphNodeName(left).localeCompare(componentGraphNodeName(right));
  });
  const graphEdges = Array.from(edges.values());

  return {
    nodes: graphNodes,
    edges: graphEdges,
    directCount: directComponentRefs.length,
    dependencyCount: graphEdges.filter((edge) => edge.kind === 'componentDependency').length,
    unresolvedCount: graphNodes.filter((node) => !node.component).length,
  };
}

function componentKindRank(kind: AppComponentRef['kind']): number {
  switch (kind) {
    case 'surface':
      return 0;
    case 'agent':
      return 1;
    case 'bridge':
      return 2;
    case 'runtime':
      return 3;
    case 'tool':
      return 4;
    case 'skill':
      return 5;
    default:
      return 6;
  }
}

function componentGraphNodeHasPermissions(node: ComponentGraphNode): boolean {
  return (node.component?.permissions?.length ?? 0) > 0;
}

function componentGraphEdgeTouchesNode(
  edge: ComponentGraphEdge,
  node: ComponentGraphNode,
): boolean {
  return edge.fromKey === node.key || edge.toKey === node.key;
}

function componentGraphNodeMatchesMode(
  node: ComponentGraphNode,
  graph: ComponentGraphModel,
  mode: ComponentGraphViewMode,
): boolean {
  switch (mode) {
    case 'composition':
      return node.direct;
    case 'dependencies':
      return graph.edges.some((edge) => edge.kind === 'componentDependency'
        && componentGraphEdgeTouchesNode(edge, node));
    case 'permissions':
      return componentGraphNodeHasPermissions(node);
    case 'unresolved':
      return !node.component;
    case 'all':
    default:
      return true;
  }
}

function componentGraphEdgeMatchesMode(
  edge: ComponentGraphEdge,
  nodeByKey: Map<string, ComponentGraphNode>,
  mode: ComponentGraphViewMode,
): boolean {
  const fromNode = edge.fromKey === 'app' ? null : nodeByKey.get(edge.fromKey) ?? null;
  const toNode = nodeByKey.get(edge.toKey) ?? null;

  switch (mode) {
    case 'composition':
      return edge.kind === 'appComposition';
    case 'dependencies':
      return edge.kind === 'componentDependency';
    case 'permissions':
      return Boolean((fromNode && componentGraphNodeHasPermissions(fromNode))
        || (toNode && componentGraphNodeHasPermissions(toNode)));
    case 'unresolved':
      return Boolean((fromNode && !fromNode.component) || (toNode && !toNode.component));
    case 'all':
    default:
      return true;
  }
}

function buildComponentGraphLayout(graph: ComponentGraphModel): ComponentGraphLayout {
  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const directNodes = graph.nodes
    .filter((node) => node.direct)
    .sort((left, right) => {
      const kindDelta = componentKindRank(left.ref.kind) - componentKindRank(right.ref.kind);
      if (kindDelta !== 0) return kindDelta;
      return componentGraphNodeName(left).localeCompare(componentGraphNodeName(right));
    });
  const dependencyNodes = graph.nodes
    .filter((node) => !node.direct)
    .sort((left, right) => componentGraphNodeName(left).localeCompare(componentGraphNodeName(right)));
  const hasSideColumn = dependencyNodes.length > 0;
  const width = (GRAPH_PADDING_X * 2)
    + GRAPH_NODE_WIDTH
    + (hasSideColumn ? GRAPH_LAYER_GAP + GRAPH_NODE_WIDTH : 0)
    + 60;
  const root: ComponentGraphRect = {
    x: GRAPH_PADDING_X,
    y: GRAPH_PADDING_Y,
    width: GRAPH_NODE_WIDTH,
    height: GRAPH_NODE_HEIGHT,
  };

  const layoutNodes: ComponentGraphLayoutNode[] = [];
  const directStartY = root.y + root.height + GRAPH_ROOT_GAP;
  directNodes.forEach((node, index) => {
    layoutNodes.push({
      ...node,
      layer: 1,
      x: GRAPH_PADDING_X,
      y: directStartY + (index * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP)),
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
    });
  });
  dependencyNodes.forEach((node, index) => {
    const incomingDependency = graph.edges.find((edge) => edge.kind === 'componentDependency'
      && edge.toKey === node.key
      && edge.fromKey !== 'app');
    const sourceNode = incomingDependency ? nodeByKey.get(incomingDependency.fromKey) ?? null : null;
    const sourceIndex = sourceNode ? directNodes.findIndex((candidate) => candidate.key === sourceNode.key) : -1;
    const preferredIndex = sourceIndex >= 0 ? sourceIndex : index;
    const occupiedY = new Set(layoutNodes
      .filter((candidate) => candidate.layer === 2)
      .map((candidate) => candidate.y));
    let y = directStartY + (preferredIndex * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP));
    while (occupiedY.has(y)) {
      y += GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP;
    }
    layoutNodes.push({
      ...node,
      layer: 2,
      x: GRAPH_PADDING_X + GRAPH_NODE_WIDTH + GRAPH_LAYER_GAP,
      y,
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
    });
  });

  const layoutBottom = Math.max(
    root.y + root.height,
    ...layoutNodes.map((node) => node.y + node.height),
  );
  const height = layoutBottom + GRAPH_PADDING_Y + 20;
  const rectByKey = new Map(layoutNodes.map((node) => [node.key, node]));
  const layoutEdges = graph.edges.flatMap<ComponentGraphLayoutEdge>((edge) => {
    const fromRect = edge.fromKey === 'app' ? root : rectByKey.get(edge.fromKey);
    const toRect = rectByKey.get(edge.toKey);
    if (!fromRect || !toRect) return [];

    if (edge.fromKey === 'app') {
      const fromX = fromRect.x + (fromRect.width / 2);
      const fromY = fromRect.y + fromRect.height;
      const toX = toRect.x + (toRect.width / 2);
      const toY = toRect.y;
      const midY = Math.round((fromY + toY) / 2);
      return [{
        ...edge,
        fromX,
        fromY,
        toX,
        toY,
        path: `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`,
      }];
    }

    const fromNode = nodeByKey.get(edge.fromKey);
    const toNode = nodeByKey.get(edge.toKey);
    const sameColumn = fromRect.x === toRect.x;
    const targetBelow = toRect.y > fromRect.y;

    if (sameColumn && targetBelow) {
      const fromX = fromRect.x + (fromRect.width / 2);
      const fromY = fromRect.y + fromRect.height;
      const toX = toRect.x + (toRect.width / 2);
      const toY = toRect.y;
      const midY = Math.round((fromY + toY) / 2);
      return [{
        ...edge,
        fromX,
        fromY,
        toX,
        toY,
        path: `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`,
      }];
    }

    const routeOnRight = !toNode?.direct || sameColumn;
    const fromX = routeOnRight ? fromRect.x + fromRect.width : fromRect.x;
    const fromY = fromRect.y + (fromRect.height / 2);
    const toX = routeOnRight ? toRect.x : toRect.x + toRect.width;
    const toY = toRect.y + (toRect.height / 2);
    const railOffset = routeOnRight ? 54 : -54;
    const railX = routeOnRight
      ? Math.max(fromX, toX) + railOffset
      : Math.min(fromX, toX) + railOffset;
    const sourceBias = fromNode?.direct === false ? 0.4 : 0.55;
    const controlLeft = fromX + ((railX - fromX) * sourceBias);
    const controlRight = toX + ((railX - toX) * sourceBias);

    return [{
      ...edge,
      fromX,
      fromY,
      toX,
      toY,
      path: `M ${fromX} ${fromY} C ${controlLeft} ${fromY}, ${controlRight} ${toY}, ${toX} ${toY}`,
    }];
  });

  return {
    root,
    nodes: layoutNodes,
    edges: layoutEdges,
    width,
    height,
  };
}

function sectionLabel(section: AppDetailSection, t: Translate): string {
  return t(`productSystem.detail.journeys.${section}.label`);
}

function sectionDescription(section: AppDetailSection, t: Translate): string {
  return t(`productSystem.detail.journeys.${section}.description`);
}

function DetailFacts({ items }: { items: DetailFact[] }) {
  const visibleItems = items.filter((item) => !item.hidden);
  if (!visibleItems.length) return null;

  return (
    <dl className="app-detail-scene__facts">
      {visibleItems.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'app-detail-scene__mono' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const AppDetailScene: React.FC<AppDetailSceneProps> = ({
  appKind,
  app,
  components,
  works,
  onBack,
  onLaunch,
  onStop,
  running,
  stopping,
  onOpenWork,
  onOpenComponent,
  managing,
  onInstall,
  onCustomize,
  onRollback,
  onSyncUpstream,
}) => {
  const { t } = useTranslation('scenes/apps');
  const isNative = appKind === 'native';
  const productApp = isNative ? null : app as ProductAppCatalogEntry;
  const authors = useMemo(() => visibleAuthors(app.authors), [app.authors]);
  const launchBehavior = getCatalogAppLaunchBehavior(app);
  const appWorks = useMemo(() => works
    .filter((work) => workReferencesApp(work, app, appKind))
    .sort((left, right) => right.updatedAt - left.updatedAt), [app, appKind, works]);
  const latestWork = appWorks[0] ?? null;
  const useStopAction = !isNative && !launchBehavior.supportsMultipleWorks && running;
  const permissionList = permissionEntries(app);
  const enabledPermissionCount = permissionList.filter((permission) => permission.enabled).length;
  const componentPermissions = components.flatMap(({ component }) => component?.permissions ?? []);
  const componentGraph = useMemo(
    () => buildComponentGraph(productApp, components),
    [components, productApp],
  );
  const componentGraphLayout = useMemo(
    () => buildComponentGraphLayout(componentGraph),
    [componentGraph],
  );

  const sections = useMemo<AppDetailSection[]>(() => {
    const next: AppDetailSection[] = ['overview', 'work'];
    if (!isNative) next.push('customize');
    next.push('control');
    return next;
  }, [isNative]);

  const [activeSection, setActiveSection] = useState<AppDetailSection>('overview');
  const [selectedGraphNodeKey, setSelectedGraphNodeKey] = useState<string | null>(null);
  const [selectedGraphEdgeKey, setSelectedGraphEdgeKey] = useState<string | null>(null);
  const [componentGraphMode, setComponentGraphMode] = useState<ComponentGraphViewMode>('all');
  const resolvedSection = sections.includes(activeSection) ? activeSection : sections[0];
  const selectedGraphRoot = selectedGraphNodeKey === 'app'
    || (selectedGraphNodeKey === null && componentGraph.nodes.length > 0);
  const selectedGraphNode = selectedGraphRoot
    ? null
    : (selectedGraphNodeKey
      ? componentGraph.nodes.find((node) => node.key === selectedGraphNodeKey) ?? null
      : componentGraph.nodes[0] ?? null);
  const selectedGraphEdge = selectedGraphEdgeKey
    ? componentGraph.edges.find((edge) => edge.key === selectedGraphEdgeKey) ?? null
    : null;

  const isInstalled = !isNative && productApp!.installed === true;
  const hasUpdate = !isNative && productApp!.updateAvailable === true;
  const canInstall = !isNative && hasManagementAction(productApp!, 'install');
  const canRunInstalledApp = isNative || isInstalled;
  const canContinueLatestWork = Boolean(latestWork && canRunInstalledApp && !useStopAction);
  const showNewWorkAction = Boolean(canContinueLatestWork && app.launch);
  const primaryActionEnabled = isNative || isInstalled || canInstall;

  const primaryActionLabel = (() => {
    if (!isNative && !isInstalled) return t('productSystem.manage.install');
    if (useStopAction) return t('productSystem.actions.stop');
    if (canContinueLatestWork) return t('productSystem.actions.continue');
    if (launchBehavior.requiresWorkspace) return t('productSystem.detail.header.chooseWorkspace');
    return launchBehavior.supportsMultipleWorks
      ? t('productSystem.actions.newWork')
      : t('productSystem.actions.launch');
  })();

  const PrimaryActionIcon = (() => {
    if (!isNative && !isInstalled) return Download;
    if (useStopAction) return Square;
    if (canContinueLatestWork) return History;
    return launchBehavior.supportsMultipleWorks ? Plus : Play;
  })();

  const handlePrimaryAction = () => {
    if (!isNative && !isInstalled) {
      if (canInstall) onInstall();
      return;
    }
    if (useStopAction) {
      onStop();
      return;
    }
    if (latestWork) {
      onOpenWork(latestWork);
      return;
    }
    onLaunch();
  };

  const primaryActionDisabled = !primaryActionEnabled
    || (!isNative && isInstalled && !productApp!.enabled && !latestWork)
    || (useStopAction && stopping)
    || managing;

  const sectionCount = (section: AppDetailSection): number | null => {
    switch (section) {
      case 'work':
        return appWorks.length;
      case 'customize':
        return !isNative && productApp!.upstreamUpdateAvailable ? 1 : null;
      case 'control':
        return enabledPermissionCount + componentPermissions.length;
      default:
        return null;
    }
  };

  const headerStatusLabel = isNative
    ? t('productSystem.detail.header.native')
    : t(productApp!.enabled ? 'productSystem.detail.enabled' : 'productSystem.detail.disabled');
  const workModeLabel = t(`productSystem.workMultiplicity.${launchBehavior.workMultiplicity}`);
  const installedLabel = isNative
    ? t('productSystem.detail.header.native')
    : t(isInstalled ? 'productSystem.detail.header.installed' : 'productSystem.detail.header.notInstalled');

  const renderSectionHeading = (section: AppDetailSection) => (
    <div className="app-detail-scene__content-heading">
      <h2>{sectionLabel(section, t)}</h2>
      <p>{sectionDescription(section, t)}</p>
    </div>
  );

  const renderWorkList = (limit?: number) => {
    const visibleWorks = typeof limit === 'number' ? appWorks.slice(0, limit) : appWorks;
    if (!visibleWorks.length) {
      return (
        <p className="app-detail-scene__muted">{t('productSystem.detail.start.noWorkDescription')}</p>
      );
    }

    return (
      <div className="app-detail-scene__work-list">
        {visibleWorks.map((work) => (
          <button
            key={work.id}
            type="button"
            className="app-detail-scene__work-row"
            onClick={() => onOpenWork(work)}
          >
            <StatusDot
              tone={workStatusTone(work.status)}
              size="small"
              pulse={work.status === 'running'}
            />
            <span className="app-detail-scene__work-info">
              <strong>{work.title}</strong>
              <small>{work.objective}</small>
            </span>
            <span className="app-detail-scene__work-meta">
              <Badge variant="neutral">{t(`productSystem.status.${work.status}`, { defaultValue: work.status })}</Badge>
              <time dateTime={new Date(work.updatedAt).toISOString()}>{relativeTimeLabel(work.updatedAt)}</time>
            </span>
          </button>
        ))}
      </div>
    );
  };

  const renderOverview = () => (
    <section className="app-detail-scene__content-section">
      {renderSectionHeading('overview')}
      <div className="app-detail-scene__overview-copy">
        {(app.tags ?? []).length ? (
          <div className="app-detail-scene__tags">
            {(app.tags ?? []).map((tag) => <Tag key={tag} size="small" color="gray">{tag}</Tag>)}
          </div>
        ) : null}
      </div>
      <div className="app-detail-scene__summary-grid">
        {authors.length ? (
          <div className="app-detail-scene__summary-item">
            <span>
              {authors.length > 1
                ? t('productSystem.fields.authors')
                : t('productSystem.fields.author')}
            </span>
            <strong className="app-detail-scene__author-list">{renderAuthorList(authors)}</strong>
          </div>
        ) : null}
        <div className="app-detail-scene__summary-item">
          <span>{t('productSystem.fields.kind')}</span>
          <strong>{t(`productSystem.interaction.${app.interactionModel}`)}</strong>
        </div>
        <div className="app-detail-scene__summary-item">
          <span>{t('productSystem.fields.scope')}</span>
          <strong>{t(`productSystem.launchScope.${app.launch?.scopeRequirement ?? 'systemAllowed'}`)}</strong>
        </div>
        <div className="app-detail-scene__summary-item">
          <span>{t('productSystem.detail.header.workMode')}</span>
          <strong>{workModeLabel}</strong>
        </div>
      </div>
      <section className="app-detail-scene__block">
        <div className="app-detail-scene__block-heading">
          <div>
            <h3 className="app-detail-scene__section-title">
              {appWorks.length
                ? t('productSystem.detail.overview.recentWork')
                : t('productSystem.detail.start.noWorkTitle')}
            </h3>
            <p>{appWorks.length
              ? t('productSystem.detail.overview.recentWorkDescription')
              : t('productSystem.detail.start.noWorkDescription')}</p>
          </div>
          {appWorks.length > 3 ? (
            <Button variant="ghost" size="small" onClick={() => setActiveSection('work')}>
              {t('productSystem.detail.overview.viewAllWork', { count: appWorks.length })}
            </Button>
          ) : null}
        </div>
        {renderWorkList(3)}
      </section>
    </section>
  );

  const renderWork = () => (
    <section className="app-detail-scene__content-section">
      {renderSectionHeading('work')}
      <section className="app-detail-scene__block">
        <div className="app-detail-scene__block-heading">
          <h3 className="app-detail-scene__section-title">{t('productSystem.detail.start.workTitle')}</h3>
          {showNewWorkAction ? (
            <Button
              variant="secondary"
              size="small"
              onClick={onLaunch}
              disabled={!isNative && !productApp!.enabled}
            >
              <Plus size={14} aria-hidden />
              {t('productSystem.actions.newWork')}
            </Button>
          ) : null}
        </div>
        {renderWorkList()}
      </section>
    </section>
  );

  const renderCustomize = () => {
    if (isNative || !productApp) return null;
    const isSystemApp = productApp.ownerKind === 'system';
    const CustomizeIcon = isSystemApp ? GitFork : PencilLine;
    const customizeLabel = isSystemApp
      ? t('productSystem.actions.customize')
      : t('productSystem.actions.edit');

    return (
      <section className="app-detail-scene__content-section">
        {renderSectionHeading('customize')}
        <section className="app-detail-scene__journey-card app-detail-scene__journey-card--accent">
          <span className="app-detail-scene__journey-icon" aria-hidden>
            <CustomizeIcon size={20} />
          </span>
          <div className="app-detail-scene__journey-copy">
            <h3>{isSystemApp
              ? t('productSystem.detail.customize.systemTitle')
              : t('productSystem.detail.customize.userTitle')}</h3>
            <p>{isSystemApp
              ? t('productSystem.detail.customize.systemDescription')
              : t('productSystem.detail.customize.userDescription')}</p>
          </div>
          <Button variant="primary" size="small" onClick={onCustomize} disabled={managing}>
            <CustomizeIcon size={14} aria-hidden />
            {customizeLabel}
          </Button>
        </section>

        {productApp.upstreamUpdateAvailable ? (
          <section className="app-detail-scene__journey-card app-detail-scene__journey-card--warning">
            <span className="app-detail-scene__journey-icon" aria-hidden>
              <RefreshCw size={20} />
            </span>
            <div className="app-detail-scene__journey-copy">
              <h3>{t('productSystem.detail.customize.upstreamTitle')}</h3>
              <p>{t('productSystem.detail.customize.upstreamDescription')}</p>
            </div>
            <Button variant="secondary" size="small" onClick={onSyncUpstream} disabled={managing}>
              <RefreshCw size={14} aria-hidden />
              {t('productSystem.actions.syncUpstream')}
            </Button>
          </section>
        ) : null}

        <section className="app-detail-scene__block">
          <div className="app-detail-scene__block-heading">
            <div>
              <h3 className="app-detail-scene__section-title">{t('productSystem.detail.customize.versionTitle')}</h3>
              <p>{t('productSystem.detail.customize.versionDescription')}</p>
            </div>
          </div>
          <DetailFacts
            items={[
              { label: t('productSystem.fields.version'), value: productApp.version },
              { label: t('productSystem.detail.customize.activeRelease'), value: productApp.releaseId, mono: true },
              { label: t('productSystem.detail.customize.availableRelease'), value: productApp.availableReleaseId, mono: true },
              { label: t('productSystem.detail.customize.owner'), value: t(`productSystem.owner.${productApp.ownerKind}`) },
            ]}
          />
          <div className="app-detail-scene__inline-actions">
            {hasUpdate ? (
              <Button variant="primary" size="small" onClick={onInstall} disabled={managing}>
                <Download size={14} aria-hidden />
                {t('productSystem.manage.update')}
              </Button>
            ) : null}
            {productApp.previousReleaseId ? (
              <Button variant="secondary" size="small" onClick={onRollback} disabled={managing}>
                <RotateCcw size={14} aria-hidden />
                {t('productSystem.actions.rollback')}
              </Button>
            ) : null}
          </div>
        </section>
      </section>
    );
  };

  const renderPermissions = () => (
    <section className="app-detail-scene__content-section">
      <section className="app-detail-scene__block">
        <h3 className="app-detail-scene__section-title">{t('productSystem.detail.permissions.appTitle')}</h3>
        <div className="app-detail-scene__permission-grid">
          {permissionList.map((permission) => (
            <div
              key={permission.key}
              className={`app-detail-scene__permission-chip${permission.enabled ? ' is-enabled' : ''}`}
            >
              <StatusDot tone={permission.enabled ? 'success' : 'neutral'} size="small" />
              <span>{t(`productSystem.permission.${permission.key}`)}</span>
            </div>
          ))}
        </div>
      </section>

      {!isNative && productApp!.dataLifecycle ? (
        <section className="app-detail-scene__block">
          <h3 className="app-detail-scene__section-title">{t('productSystem.detail.permissions.dataTitle')}</h3>
          <DetailFacts
            items={[
              {
                label: t('productSystem.dataLifecycle.fields.retention'),
                value: productApp!.dataLifecycle.retention
                  ? t(`productSystem.dataLifecycle.retention.${productApp!.dataLifecycle.retention}`)
                  : '-',
              },
              {
                label: t('productSystem.dataLifecycle.fields.deletion'),
                value: productApp!.dataLifecycle.deletion
                  ? t(`productSystem.dataLifecycle.deletion.${productApp!.dataLifecycle.deletion}`)
                  : '-',
              },
              {
                label: t('productSystem.dataLifecycle.fields.migration'),
                value: productApp!.dataLifecycle.migration
                  ? t(`productSystem.dataLifecycle.migration.${productApp!.dataLifecycle.migration}`)
                  : '-',
              },
              {
                label: t('productSystem.dataLifecycle.fields.share'),
                value: productApp!.dataLifecycle.share
                  ? t(`productSystem.dataLifecycle.share.${productApp!.dataLifecycle.share}`)
                  : '-',
              },
            ]}
          />
        </section>
      ) : null}

      {componentPermissions.length ? (
        <section className="app-detail-scene__block">
          <h3 className="app-detail-scene__section-title">{t('productSystem.detail.permissions.componentTitle')}</h3>
          <div className="app-detail-scene__perm-detail-list">
            {componentPermissions.map((perm, index) => (
              <div key={`${perm.kind}:${index}`} className="app-detail-scene__perm-detail">
                <strong>{perm.kind}</strong>
                {perm.summary ? <span>{perm.summary}</span> : null}
                {(perm.scopes ?? []).length ? <small>{(perm.scopes ?? []).join(', ')}</small> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );

  const renderTechnical = () => {
    const nodeByKey = new Map(componentGraph.nodes.map((node) => [node.key, node]));
    const endpointLabel = (key: 'app' | string): string => {
      if (key === 'app') return app.name;
      const node = nodeByKey.get(key);
      return node ? componentGraphNodeName(node) : key;
    };
    const graphCanvasStyle = {
      '--app-detail-graph-width': `${componentGraphLayout.width}px`,
      '--app-detail-graph-height': `${componentGraphLayout.height}px`,
    } as React.CSSProperties;

    return (
      <section className="app-detail-scene__content-section">
        <div className="app-detail-scene__content-heading">
          <h2>{t('productSystem.detail.tabs.technical')}</h2>
          <p>{t('productSystem.detail.sectionDescription.technical')}</p>
        </div>
        {componentGraph.nodes.length ? (
          <>
            <div className="app-detail-scene__summary-grid">
              <div className="app-detail-scene__summary-item">
                <span>{t('productSystem.detail.technical.directComponents')}</span>
                <strong>{componentGraph.directCount}</strong>
              </div>
              <div className="app-detail-scene__summary-item">
                <span>{t('productSystem.detail.technical.dependencyEdges')}</span>
                <strong>{componentGraph.dependencyCount}</strong>
              </div>
              <div className="app-detail-scene__summary-item">
                <span>{t('productSystem.detail.technical.primarySurface')}</span>
                <strong>{productApp?.primarySurface?.componentId ?? '-'}</strong>
              </div>
              <div className="app-detail-scene__summary-item">
                <span>{t('productSystem.detail.technical.unresolved')}</span>
                <strong>{componentGraph.unresolvedCount}</strong>
              </div>
            </div>

            <div className="app-detail-scene__component-graph">
              <div className="app-detail-scene__component-graph-main">
                <section className="app-detail-scene__graph-panel">
                  <div className="app-detail-scene__graph-panel-heading">
                    <h3>{t('productSystem.detail.technical.canvasTitle')}</h3>
                    <p>{t('productSystem.detail.technical.canvasDescription')}</p>
                  </div>
                  <div
                    className="app-detail-scene__graph-toolbar"
                    aria-label={t('productSystem.detail.technical.filterLabel')}
                  >
                    {COMPONENT_GRAPH_VIEW_MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`app-detail-scene__graph-filter${componentGraphMode === mode ? ' is-active' : ''}`}
                        aria-pressed={componentGraphMode === mode}
                        onClick={() => setComponentGraphMode(mode)}
                      >
                        {t(`productSystem.detail.technical.filter.${mode}`)}
                      </button>
                    ))}
                  </div>
                  <div className="app-detail-scene__graph-canvas" style={graphCanvasStyle}>
                    <div className="app-detail-scene__graph-viewport">
                      <svg
                        className="app-detail-scene__graph-svg"
                        viewBox={`0 0 ${componentGraphLayout.width} ${componentGraphLayout.height}`}
                        role="img"
                        aria-label={t('productSystem.detail.technical.canvasTitle')}
                      >
                        <defs>
                          <marker
                            id="app-detail-graph-arrow"
                            markerWidth="7"
                            markerHeight="7"
                            refX="6.2"
                            refY="3.5"
                            orient="auto"
                            markerUnits="strokeWidth"
                          >
                            <path d="M 0 0 L 7 3.5 L 0 7 z" />
                          </marker>
                        </defs>
                        {componentGraphLayout.edges.map((edge) => {
                          const edgeMatchesMode = componentGraphEdgeMatchesMode(edge, nodeByKey, componentGraphMode);
                          const edgeSelected = selectedGraphEdge?.key === edge.key;
                          const edgeRelated = selectedGraphRoot
                            ? edge.fromKey === 'app'
                            : Boolean(selectedGraphNode && componentGraphEdgeTouchesNode(edge, selectedGraphNode));
                          const labelX = Math.round((edge.fromX + edge.toX) / 2);
                          const labelY = Math.round((edge.fromY + edge.toY) / 2) - 8;
                          const selectEdge = () => {
                            setSelectedGraphEdgeKey(edge.key);
                            setSelectedGraphNodeKey(edge.toKey);
                          };

                          return (
                            <g
                              key={edge.key}
                              className={`app-detail-scene__graph-edge app-detail-scene__graph-edge--${edge.kind}${edgeMatchesMode ? '' : ' is-muted'}${edgeSelected ? ' is-selected' : ''}${edgeRelated && !edgeSelected ? ' is-related' : ''}`}
                              role="button"
                              tabIndex={0}
                              aria-label={t('productSystem.detail.technical.selectRelation', {
                                from: endpointLabel(edge.fromKey),
                                to: endpointLabel(edge.toKey),
                                role: edge.label,
                              })}
                              onClick={selectEdge}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  selectEdge();
                                }
                              }}
                            >
                              <path className="app-detail-scene__graph-edge-hit" d={edge.path} />
                              <path
                                className="app-detail-scene__graph-edge-line"
                                d={edge.path}
                                markerEnd="url(#app-detail-graph-arrow)"
                              />
                              <text
                                className="app-detail-scene__graph-edge-label"
                                x={labelX}
                                y={labelY}
                                textAnchor="middle"
                              >
                                {edge.label}
                              </text>
                            </g>
                          );
                        })}
                      </svg>

                      <button
                        type="button"
                        className={`app-detail-scene__graph-app-node${selectedGraphRoot ? ' is-selected' : ''}`}
                        style={{
                          left: componentGraphLayout.root.x,
                          top: componentGraphLayout.root.y,
                          width: componentGraphLayout.root.width,
                          height: componentGraphLayout.root.height,
                        }}
                        aria-label={t('productSystem.detail.technical.selectApp', { name: app.name })}
                        onClick={() => {
                          setSelectedGraphNodeKey('app');
                          setSelectedGraphEdgeKey(null);
                        }}
                      >
                        <span>{t('productSystem.detail.technical.appNode')}</span>
                        <strong>{app.name}</strong>
                        <small>{app.id}</small>
                      </button>

                      {componentGraphLayout.nodes.map((node) => {
                        const nodeMatchesMode = componentGraphNodeMatchesMode(node, componentGraph, componentGraphMode);
                        const nodeSelected = selectedGraphNode?.key === node.key && !selectedGraphEdge;
                        const nodeRelated = selectedGraphEdge
                          ? componentGraphEdgeTouchesNode(selectedGraphEdge, node)
                          : Boolean(selectedGraphNode && componentGraph.edges.some((edge) => (
                            componentGraphEdgeTouchesNode(edge, selectedGraphNode)
                            && componentGraphEdgeTouchesNode(edge, node)
                          )));

                        return (
                          <button
                            key={node.key}
                            type="button"
                            className={`app-detail-scene__graph-canvas-node${nodeSelected ? ' is-selected' : ''}${nodeRelated && !nodeSelected ? ' is-related' : ''}${nodeMatchesMode ? '' : ' is-muted'}${!node.component ? ' is-unresolved' : ''}`}
                            style={{
                              left: node.x,
                              top: node.y,
                              width: node.width,
                              height: node.height,
                            }}
                            aria-label={t('productSystem.detail.technical.selectComponent', {
                              name: componentGraphNodeName(node),
                            })}
                            onClick={() => {
                              setSelectedGraphNodeKey(node.key);
                              setSelectedGraphEdgeKey(null);
                            }}
                          >
                            <span className="app-detail-scene__graph-canvas-node-topline">
                              <Badge variant="neutral">{t(`productSystem.componentKinds.${node.ref.kind}`)}</Badge>
                              <Tag size="small" color="gray">
                                {node.direct
                                  ? t('productSystem.detail.technical.directNode')
                                  : t('productSystem.detail.technical.dependencyNode')}
                              </Tag>
                            </span>
                            <strong>{componentGraphNodeName(node)}</strong>
                            <small>{node.ref.componentId}</small>
                            <span className="app-detail-scene__graph-canvas-node-meta">
                              <Tag size="small" color="gray">{node.ref.role}</Tag>
                              <Tag size="small" color="gray">{t(`productSystem.componentRefSource.${node.ref.source}`)}</Tag>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            imageSize="small"
            title={t('productSystem.detail.technical.emptyTitle')}
            description={t('productSystem.detail.technical.emptyDescription')}
          />
        )}
      </section>
    );
  };

  const renderComponents = () => (
    <section className="app-detail-scene__content-section">
      {components.length ? (
        <div className="app-detail-scene__component-list">
          {components.map(({ ref, component }) => (
            <button
              key={`${ref.kind}:${ref.componentId}:${ref.role}`}
              type="button"
              className="app-detail-scene__component-row"
              onClick={() => onOpenComponent(ref.componentId)}
              disabled={!component}
            >
              <div className="app-detail-scene__component-info">
                <div className="app-detail-scene__component-heading">
                  <Badge variant="neutral">{t(`productSystem.componentKinds.${ref.kind}`)}</Badge>
                  <strong>{component?.name ?? ref.componentId}</strong>
                </div>
                {component?.description ? <p>{component.description}</p> : null}
                <div className="app-detail-scene__component-meta">
                  <Tag size="small" color="gray">{ref.role}</Tag>
                  <Badge variant={ref.source === 'shared' ? 'info' : 'accent'}>
                    {t(`productSystem.componentRefSource.${ref.source}`)}
                  </Badge>
                  {ref.version ? <Tag size="small" color="gray">{ref.version}</Tag> : null}
                  {component?.capabilities?.length ? (
                    <Tag size="small" color="gray">
                      {t('productSystem.detail.components.capabilityCount', { count: component.capabilities.length })}
                    </Tag>
                  ) : null}
                </div>
              </div>
              <ChevronRight className="app-detail-scene__component-arrow" size={14} aria-hidden />
            </button>
          ))}
        </div>
      ) : (
        <p className="app-detail-scene__muted">{t('productSystem.detail.components.unresolved')}</p>
      )}
      {!isNative ? (
        <details className="app-detail-scene__graph-disclosure">
          <summary>
            <span>{t('productSystem.detail.components.graphSummary')}</span>
            <Badge variant="neutral">{componentGraph.nodes.length}</Badge>
          </summary>
          {renderTechnical()}
        </details>
      ) : null}
    </section>
  );

  const renderPackage = () => {
    if (isNative) return null;

    return (
      <section className="app-detail-scene__content-section">
        <DetailFacts
          items={[
            { label: t('productSystem.fields.version'), value: productApp!.version },
            { label: t('productSystem.detail.source.installedStatus'), value: installedLabel },
            { label: t('productSystem.manage.updateAvailable'), value: hasUpdate ? t('productSystem.manage.updateAvailable') : '-' },
            { label: t('productSystem.detail.source.catalogSource'), value: productApp!.catalogSource?.label ?? '-' },
            { label: t('productSystem.manage.updatePreviewRelease'), value: productApp!.catalogReleaseLabel ?? productApp!.catalogReleaseId ?? '-' },
            { label: t('productSystem.manage.updatePreviewPublished'), value: formatTimestamp(productApp!.catalogPublishedAtMs) },
            { label: t('productSystem.detail.source.dependencySummary'), value: productApp!.dependencySummary ?? '-', hidden: !productApp!.dependencySummary },
            { label: t('productSystem.manage.updatePreviewPackage'), value: productApp!.packageDigest ?? productApp!.installedPackageDigest ?? '-', mono: true },
            { label: t('productSystem.manage.updatePreviewComponentLock'), value: productApp!.componentLockDigest, mono: true },
          ]}
        />
      </section>
    );
  };

  const renderControl = () => (
    <section className="app-detail-scene__content-section">
      {renderSectionHeading('control')}
      <div className="app-detail-scene__summary-grid">
        <div className="app-detail-scene__summary-item">
          <span>{t('productSystem.detail.summary.availability')}</span>
          <strong>{installedLabel}</strong>
        </div>
        <div className="app-detail-scene__summary-item">
          <span>{t('productSystem.detail.summary.status')}</span>
          <strong>{headerStatusLabel}</strong>
        </div>
        <div className="app-detail-scene__summary-item">
          <span>{t('productSystem.detail.summary.permissions')}</span>
          <strong>{t('productSystem.detail.summary.permissionCount', {
            enabled: enabledPermissionCount,
            total: permissionList.length,
          })}</strong>
        </div>
      </div>

      {renderPermissions()}

      {!isNative ? (
        <details className="app-detail-scene__graph-disclosure app-detail-scene__control-disclosure">
          <summary>
            <span>{t('productSystem.detail.control.componentsTitle')}</span>
            <Badge variant="neutral">{components.length}</Badge>
          </summary>
          {renderComponents()}
        </details>
      ) : null}

      {!isNative ? (
        <details className="app-detail-scene__graph-disclosure app-detail-scene__control-disclosure">
          <summary>
            <span>{t('productSystem.detail.control.technicalTitle')}</span>
            <span className="app-detail-scene__control-summary-hint">
              {t('productSystem.detail.control.technicalHint')}
            </span>
          </summary>
          {renderPackage()}
        </details>
      ) : null}
    </section>
  );

  const renderActiveSection = () => {
    switch (resolvedSection) {
      case 'overview':
        return renderOverview();
      case 'work':
        return renderWork();
      case 'customize':
        return renderCustomize();
      case 'control':
        return renderControl();
      default:
        return renderOverview();
    }
  };

  const sectionIcon = (section: AppDetailSection) => {
    switch (section) {
      case 'overview':
        return <LayoutDashboard size={16} aria-hidden />;
      case 'work':
        return <BriefcaseBusiness size={16} aria-hidden />;
      case 'customize':
        return <Sprout size={16} aria-hidden />;
      case 'control':
        return <ShieldCheck size={16} aria-hidden />;
      default:
        return null;
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onBack();
      }}
      size="xlarge"
      className="app-detail-dialog"
      overlayClassName="app-detail-dialog-overlay"
      showCloseButton={false}
      ariaLabel={t('productSystem.detail.dialogLabel', { name: app.name })}
    >
      <DialogBody className="app-detail-dialog__body">
        <div className="app-detail-scene app-detail-scene--dialog" data-testid="app-detail-dialog" data-app-kind={appKind}>
          <header className="app-detail-scene__header">
            <IconButton
              className="app-detail-scene__header-close"
              variant="ghost"
              size="small"
              shape="circle"
              aria-label={t('productSystem.actions.close')}
              tooltip={t('productSystem.actions.close')}
              onClick={onBack}
            >
              <X size={14} aria-hidden />
            </IconButton>
            <div className="app-detail-scene__header-main">
              <span className="app-detail-scene__header-icon" aria-hidden>
                <AppIcon app={app} size={52} />
              </span>
              <div className="app-detail-scene__header-copy">
                <div className="app-detail-scene__header-title-row">
                  <h1>{app.name}</h1>
                  {!isNative ? <span className="app-detail-scene__version">v{productApp!.version}</span> : null}
                </div>
                <div className="app-detail-scene__header-badges">
                  <Badge variant={isInstalled || isNative ? 'success' : 'neutral'}>{installedLabel}</Badge>
                  {!isNative ? (
                    <Badge variant={productApp!.ownerKind === 'system' ? 'info' : 'accent'}>
                      {t(`productSystem.owner.${productApp!.ownerKind}`)}
                    </Badge>
                  ) : null}
                  {hasUpdate ? <Badge variant="warning">{t('productSystem.manage.updateAvailable')}</Badge> : null}
                  {!isNative && productApp!.upstreamUpdateAvailable ? (
                    <Badge variant="warning">{t('productSystem.detail.customize.upstreamBadge')}</Badge>
                  ) : null}
                </div>
                {app.description ? <p>{app.description}</p> : null}
              </div>
            </div>
            <div className="app-detail-scene__header-actions">
              {primaryActionEnabled ? (
                <IconButton
                  variant="primary"
                  size="small"
                  shape="circle"
                  aria-label={primaryActionLabel}
                  tooltip={primaryActionLabel}
                  onClick={handlePrimaryAction}
                  disabled={primaryActionDisabled}
                  isLoading={managing || (useStopAction && stopping)}
                >
                  <PrimaryActionIcon size={15} aria-hidden />
                </IconButton>
              ) : null}
            </div>
          </header>

          <div className="app-detail-scene__layout">
            <aside className="app-detail-scene__sections">
              <nav className="app-detail-scene__section-nav" aria-label={t('productSystem.detail.sectionsLabel')}>
                {sections.map((section) => {
                  const count = sectionCount(section);
                  return (
                    <button
                      key={section}
                      type="button"
                      className={`app-detail-scene__section${resolvedSection === section ? ' is-active' : ''}`}
                      aria-current={resolvedSection === section ? 'page' : undefined}
                      onClick={() => setActiveSection(section)}
                    >
                      {sectionIcon(section)}
                      <span className="app-detail-scene__section-copy">
                        <strong>{sectionLabel(section, t)}</strong>
                        <small>{sectionDescription(section, t)}</small>
                      </span>
                      {count !== null ? <span className="app-detail-scene__section-count">{count}</span> : null}
                    </button>
                  );
                })}
              </nav>
              <div className="app-detail-scene__nav-status">
                <div>
                  <StatusDot tone={productApp?.enabled || isNative ? 'success' : 'neutral'} size="small" />
                  <span>{headerStatusLabel}</span>
                </div>
                <div>
                  <StatusDot tone="info" size="small" />
                  <span>{t(`productSystem.launchScope.${app.launch?.scopeRequirement ?? 'systemAllowed'}`)}</span>
                </div>
              </div>
            </aside>
            <main className="app-detail-scene__content">
              {renderActiveSection()}
            </main>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  );
};

export default AppDetailScene;
