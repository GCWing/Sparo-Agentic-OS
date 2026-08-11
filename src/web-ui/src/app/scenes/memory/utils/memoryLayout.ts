import type { MemoryRecord, MemoryRecordType, MemoryScopeKey } from '../MemoryLibraryAPI';

const TWO_PI = Math.PI * 2;

export interface PositionedNode {
  record: MemoryRecord;
  x: number;
  y: number;
  radius: number;
  groupId: string;
}

export interface MemoryGroup {
  id: string;
  scope: MemoryScopeKey;
  label: string;
  isCore: boolean;
  cx: number;
  cy: number;
  ringRadius: number;
  records: MemoryRecord[];
  color: string;
}

export interface MemoryEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: 'index-spoke' | 'co-folder' | 'cross-scope' | 'source-session' | 'link';
}

export interface MemoryLayout {
  width: number;
  height: number;
  groups: MemoryGroup[];
  nodes: PositionedNode[];
  edges: MemoryEdge[];
}

export interface BuildLayoutInput {
  records: MemoryRecord[];
  workspaceLabels: Record<string, string>;
  globalLabel: string;
  width: number;
  height: number;
}

export const TYPE_COLORS: Record<MemoryRecordType, string> = {
  memory: 'var(--ds-color-warning)',
  soul: 'var(--ds-color-brand-core)',
  user: 'var(--ds-color-info)',
  milestone: 'var(--ds-color-success)',
  host_overview: 'var(--ds-color-accent-500)',
  memory_log: 'var(--ds-color-text-muted)',
  workspace_overview: 'var(--ds-color-info)',
  unknown: 'var(--ds-color-text-muted)',
};

export const hexPolygonPoints = (radius: number): string => {
  const points: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 3) * index - Math.PI / 2;
    points.push(`${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`);
  }
  return points.join(' ');
};

const stableHash = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

const nodeRadiusFor = (record: MemoryRecord): number => {
  if (record.type === 'memory') return 11;
  if (record.isWorkspaceOverview) return 10;
  const baseLength = (record.content?.length ?? 0) + (record.description?.length ?? 0);
  if (baseLength > 4000) return 9;
  if (baseLength > 1500) return 8;
  if (baseLength > 400) return 7;
  return 6;
};

const placeRecordsInsideRing = (
  records: MemoryRecord[],
  cx: number,
  cy: number,
  ringRadius: number,
  groupId: string,
): PositionedNode[] => {
  const positioned: PositionedNode[] = [];
  const central =
    records.find((record) => record.type === 'memory')
    ?? records.find((record) => record.isWorkspaceOverview)
    ?? null;
  const others = records.filter((record) => record !== central);

  if (central) {
    positioned.push({
      record: central,
      x: cx,
      y: cy,
      radius: nodeRadiusFor(central),
      groupId,
    });
  }

  if (others.length === 0) return positioned;

  const innerR1 = ringRadius * 0.55;
  const innerR2 = ringRadius * 0.82;
  const ring1Count = Math.min(others.length, Math.max(6, Math.ceil(others.length / 2)));
  const ring1 = others.slice(0, ring1Count);
  const ring2 = others.slice(ring1Count);

  const distribute = (items: MemoryRecord[], radiusBase: number, phase: number) => {
    const total = items.length;
    items.forEach((record, index) => {
      const baseAngle = (index / total) * TWO_PI + phase;
      const jitter = ((stableHash(record.id) % 1000) / 1000 - 0.5) * 0.18;
      const angle = baseAngle + jitter;
      const radius = radiusBase * (0.92 + ((stableHash(`${record.id}:r`) % 1000) / 1000 - 0.5) * 0.12);
      positioned.push({
        record,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        radius: nodeRadiusFor(record),
        groupId,
      });
    });
  };

  distribute(ring1, innerR1, -Math.PI / 2);
  distribute(ring2, innerR2, -Math.PI / 2 + Math.PI / Math.max(ring2.length || 1, 1));

  return positioned;
};

const colorForGroup = (id: string, isCore: boolean): string => {
  if (isCore) return 'var(--ds-color-warning)';
  const palette = [
    'var(--ds-color-info)',
    'var(--ds-color-accent-500)',
    'var(--ds-color-purple-500)',
    'var(--ds-color-success)',
    'var(--ds-color-brand-core)',
    'var(--ds-color-warning)',
    'var(--ds-color-accent-400)',
  ];
  return palette[stableHash(id) % palette.length];
};

const dirSegments = (relativePath: string): string[] => {
  return relativePath.split('/').slice(0, -1).filter(Boolean);
};

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '');

const matchOverviewForLabel = (
  overviews: PositionedNode[],
  label: string,
): PositionedNode | undefined => {
  if (overviews.length === 0 || !label) return undefined;
  const targetSlug = slugify(label);
  const targetLower = label.toLowerCase();
  if (!targetSlug && !targetLower) return undefined;

  for (const overview of overviews) {
    const fileName = (overview.record.relativePath.split('/').pop() ?? '')
      .replace(/\.md$/i, '')
      .toLowerCase();
    const fileSlug = slugify(fileName);
    const titleSlug = slugify(overview.record.title);
    const workspaceSlug = slugify(overview.record.workspaceLabel ?? '');
    if (
      fileName === targetLower
      || fileSlug === targetSlug
      || titleSlug === targetSlug
      || workspaceSlug === targetSlug
      || (targetSlug && (fileSlug.includes(targetSlug) || targetSlug.includes(fileSlug)))
    ) {
      return overview;
    }
  }

  return undefined;
};

export const buildMemoryLayout = ({
  records,
  workspaceLabels,
  globalLabel,
  width,
  height,
}: BuildLayoutInput): MemoryLayout => {
  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);

  const globalRecords = records.filter((record) => record.scope === 'global' && !record.isWorkspaceOverview);

  const wsGroups = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    if (record.scope !== 'workspace' && !record.isWorkspaceOverview) continue;
    const list = wsGroups.get(record.groupKey) ?? [];
    list.push(record);
    wsGroups.set(record.groupKey, list);
  }

  const coreRadius = Math.max(110, Math.min(minDim * 0.28, 180 + Math.sqrt(globalRecords.length) * 12));

  const groups: MemoryGroup[] = [];
  const nodes: PositionedNode[] = [];
  const edges: MemoryEdge[] = [];

  const coreGroup: MemoryGroup = {
    id: 'core',
    scope: 'global',
    label: globalLabel,
    isCore: true,
    cx,
    cy,
    ringRadius: coreRadius,
    records: globalRecords,
    color: colorForGroup('core', true),
  };
  groups.push(coreGroup);
  nodes.push(...placeRecordsInsideRing(globalRecords, cx, cy, coreRadius, coreGroup.id));

  const wsEntries = Array.from(wsGroups.entries());
  const orbitRadius = Math.max(coreRadius + 90, minDim * 0.42);
  const wsRingRadius = Math.min(120, Math.max(70, minDim * 0.16));

  wsEntries.forEach(([groupKey, list], index) => {
    const total = wsEntries.length;
    const angle = total === 1 ? -Math.PI / 4 : (index / total) * TWO_PI - Math.PI / 2;
    const wcx = cx + Math.cos(angle) * orbitRadius;
    const wcy = cy + Math.sin(angle) * orbitRadius;
    const id = `ws:${groupKey}`;
    const workspaceRecord = list.find((record) => record.scope === 'workspace');
    const overviewRecord = list.find((record) => record.isWorkspaceOverview);
    const label = overviewRecord?.workspaceLabel
      ?? (workspaceRecord ? workspaceLabels[workspaceRecord.memoryDir] : undefined)
      ?? list[0]?.workspaceLabel
      ?? list[0]?.title
      ?? 'Workspace';

    const group: MemoryGroup = {
      id,
      scope: 'workspace',
      label,
      isCore: false,
      cx: wcx,
      cy: wcy,
      ringRadius: wsRingRadius,
      records: list,
      color: colorForGroup(id, false),
    };
    groups.push(group);
    nodes.push(...placeRecordsInsideRing(list, wcx, wcy, wsRingRadius, id));
  });

  for (const group of groups) {
    const hubNode =
      nodes.find((node) => node.groupId === group.id && node.record.type === 'memory')
      ?? nodes.find((node) => node.groupId === group.id && node.record.isWorkspaceOverview);
    if (!hubNode) continue;
    const siblings = nodes.filter((node) => node.groupId === group.id && node !== hubNode);
    siblings.slice(0, 12).forEach((node) => {
      edges.push({
        id: `spoke:${hubNode.record.id}->${node.record.id}`,
        fromId: hubNode.record.id,
        toId: node.record.id,
        kind: 'index-spoke',
      });
    });
  }

  for (const group of groups) {
    const groupNodes = nodes.filter((node) => node.groupId === group.id && !node.record.isWorkspaceOverview);
    const buckets = new Map<string, PositionedNode[]>();
    for (const node of groupNodes) {
      const segment = dirSegments(node.record.relativePath)[0];
      if (!segment || segment === 'workspaces_overview' || segment === 'logs') continue;
      const list = buckets.get(segment) ?? [];
      list.push(node);
      buckets.set(segment, list);
    }
    for (const [, list] of buckets) {
      if (list.length < 2) continue;
      for (let index = 0; index < list.length - 1; index += 1) {
        edges.push({
          id: `cofolder:${list[index].record.id}->${list[index + 1].record.id}`,
          fromId: list[index].record.id,
          toId: list[index + 1].record.id,
          kind: 'co-folder',
        });
      }
    }
  }

  const overviewNodes = nodes.filter((node) => node.record.isWorkspaceOverview);
  for (const group of groups) {
    if (group.isCore) continue;
    const memoryNode =
      nodes.find((node) => node.groupId === group.id && node.record.type === 'memory')
      ?? nodes.find((node) => node.groupId === group.id);
    if (!memoryNode) continue;
    const matched = matchOverviewForLabel(overviewNodes, group.label);
    if (matched && matched.record.id !== memoryNode.record.id) {
      edges.push({
        id: `bridge:${memoryNode.record.id}->${matched.record.id}`,
        fromId: memoryNode.record.id,
        toId: matched.record.id,
        kind: 'cross-scope',
      });
    }
  }

  return { width, height, groups, nodes, edges };
};

export const getTypeColor = (type: MemoryRecordType): string => TYPE_COLORS[type] ?? TYPE_COLORS.unknown;

export interface RelatedRecordRef {
  record: MemoryRecord;
  reason: 'index' | 'same-folder' | 'cross-scope';
}

const overviewMatchesLabel = (record: MemoryRecord, label: string): boolean => {
  if (!record.isWorkspaceOverview || !label) return false;
  const targetSlug = slugify(label);
  const targetLower = label.toLowerCase();
  const fileName = (record.relativePath.split('/').pop() ?? '')
    .replace(/\.md$/i, '')
    .toLowerCase();
  const fileSlug = slugify(fileName);
  const titleSlug = slugify(record.title);
  const workspaceSlug = slugify(record.workspaceLabel ?? '');
  return (
    fileName === targetLower
    || fileSlug === targetSlug
    || titleSlug === targetSlug
    || workspaceSlug === targetSlug
    || (Boolean(targetSlug) && (fileSlug.includes(targetSlug) || targetSlug.includes(fileSlug)))
  );
};

export const getRelatedRecords = (
  target: MemoryRecord,
  records: MemoryRecord[],
  workspaceLabel?: string,
): RelatedRecordRef[] => {
  const related: RelatedRecordRef[] = [];
  const seen = new Set<string>([target.id]);

  const sameSegment = dirSegments(target.relativePath)[0];
  const isOverviewFolder = sameSegment === 'workspaces_overview';

  for (const record of records) {
    if (seen.has(record.id)) continue;

    if (record.groupKey === target.groupKey) {
      if (record.type === 'memory' && target.type !== 'memory') {
        related.push({ record, reason: 'index' });
        seen.add(record.id);
        continue;
      }
      if (target.isWorkspaceOverview && record.isWorkspaceOverview) continue;
      const segment = dirSegments(record.relativePath)[0];
      if (
        sameSegment
        && segment === sameSegment
        && !isOverviewFolder
        && !record.isWorkspaceOverview
      ) {
        related.push({ record, reason: 'same-folder' });
        seen.add(record.id);
      }
      continue;
    }

    if (
      target.scope === 'workspace'
      && target.type === 'memory'
      && record.isWorkspaceOverview
      && workspaceLabel
      && overviewMatchesLabel(record, workspaceLabel)
    ) {
      related.push({ record, reason: 'cross-scope' });
      seen.add(record.id);
      continue;
    }
    if (
      target.isWorkspaceOverview
      && record.scope === 'workspace'
      && record.type === 'memory'
      && workspaceLabel
      && overviewMatchesLabel(target, workspaceLabel)
    ) {
      related.push({ record, reason: 'cross-scope' });
      seen.add(record.id);
    }
  }

  return related.slice(0, 12);
};
