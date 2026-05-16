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
  // Core index
  index: 'var(--color-warning)',
  // New layer-aligned types
  identity: 'var(--color-warning)',
  narrative: 'var(--color-error)',
  persona: 'var(--color-info)',
  project: 'var(--color-success)',
  habit: 'var(--color-warning)',
  episodic: 'var(--color-accent-500)',
  pinned: 'var(--color-info)',
  session: 'var(--color-text-muted)',
  reference: 'var(--color-purple-500)',
  workspace_overview: 'var(--color-info)',
  // Legacy (migration period)
  user: 'var(--color-info)',
  feedback: 'var(--color-error)',
  unknown: 'var(--color-text-muted)',
};

/** Flat-top hex centered at origin; use with SVG polygon and viewBox centered on (0,0). */
export const hexPolygonPoints = (radius: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`);
  }
  return pts.join(' ');
};

const stableHash = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};

const nodeRadiusFor = (record: MemoryRecord): number => {
  if (record.isIndex) return 11;
  if (record.isWorkspaceOverview) return 10;
  const baseLen = (record.content?.length ?? 0) + (record.description?.length ?? 0);
  if (baseLen > 4000) return 9;
  if (baseLen > 1500) return 8;
  if (baseLen > 400) return 7;
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
  // Hub: prefer MEMORY.md index per space; workspace overview orbits with other files.
  const central =
    records.find((record) => record.isIndex)
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

  // Distribute on up to 2 concentric inner rings.
  const innerR1 = ringRadius * 0.55;
  const innerR2 = ringRadius * 0.82;
  const ring1Count = Math.min(others.length, Math.max(6, Math.ceil(others.length / 2)));
  const ring1 = others.slice(0, ring1Count);
  const ring2 = others.slice(ring1Count);

  const distribute = (items: MemoryRecord[], r: number, phase: number) => {
    const total = items.length;
    items.forEach((record, i) => {
      const baseAngle = (i / total) * TWO_PI + phase;
      const jitter = ((stableHash(record.id) % 1000) / 1000 - 0.5) * 0.18;
      const angle = baseAngle + jitter;
      const radius = r * (0.92 + ((stableHash(record.id + ':r') % 1000) / 1000 - 0.5) * 0.12);
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
  if (isCore) return 'var(--color-warning)';
  const palette = [
    'var(--color-info)',
    'var(--color-accent-500)',
    'var(--color-purple-500)',
    'var(--color-success)',
    'var(--color-error)',
    'var(--color-warning)',
    'var(--color-accent-400)',
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
    if (
      fileName === targetLower
      || fileSlug === targetSlug
      || titleSlug === targetSlug
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

  const globalRecords = records.filter((record) => record.scope === 'global');

  // Workspace records grouped by memoryDir (each workspace has its own memoryDir).
  const wsGroups = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    if (record.scope !== 'workspace') continue;
    const arr = wsGroups.get(record.memoryDir) ?? [];
    arr.push(record);
    wsGroups.set(record.memoryDir, arr);
  }

  // Core ring radius scales with global node count.
  const coreRadius = Math.max(110, Math.min(minDim * 0.28, 180 + Math.sqrt(globalRecords.length) * 12));

  const groups: MemoryGroup[] = [];
  const nodes: PositionedNode[] = [];
  const edges: MemoryEdge[] = [];

  // --- Core group (global) ---
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

  // --- Workspace orbits ---
  const wsEntries = Array.from(wsGroups.entries());
  const orbitRadius = Math.max(coreRadius + 90, minDim * 0.42);
  const wsRingRadius = Math.min(120, Math.max(70, minDim * 0.16));

  wsEntries.forEach(([memoryDir, list], idx) => {
    const total = wsEntries.length;
    const angle = total === 1 ? -Math.PI / 4 : (idx / total) * TWO_PI - Math.PI / 2;
    const wcx = cx + Math.cos(angle) * orbitRadius;
    const wcy = cy + Math.sin(angle) * orbitRadius;
    const id = `ws:${memoryDir}`;
    const label = workspaceLabels[memoryDir] ?? list[0]?.title ?? 'Workspace';
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

  // --- Edges ---
  // 1) Index-spoke: MEMORY.md index per group connects to top-N siblings (incl. workspace overview).
  for (const group of groups) {
    const indexNode =
      nodes.find((n) => n.groupId === group.id && n.record.isIndex)
      ?? nodes.find((n) => n.groupId === group.id && n.record.isWorkspaceOverview);
    if (!indexNode) continue;
    const siblings = nodes.filter((n) => n.groupId === group.id && n !== indexNode);
    siblings.slice(0, 12).forEach((n) => {
      edges.push({
        id: `spoke:${indexNode.record.id}->${n.record.id}`,
        fromId: indexNode.record.id,
        toId: n.record.id,
        kind: 'index-spoke',
      });
    });
  }

  // 2) Co-folder edges within same group when first dir segment matches.
  //    Workspace overview files (workspaces_overview/*.md in the global space) must NOT
  //    connect to each other, so we exclude them entirely from co-folder bucketing.
  for (const group of groups) {
    const groupNodes = nodes.filter(
      (n) => n.groupId === group.id && !n.record.isWorkspaceOverview,
    );
    const buckets = new Map<string, PositionedNode[]>();
    for (const n of groupNodes) {
      const seg = dirSegments(n.record.relativePath)[0];
      if (!seg || seg === 'workspaces_overview') continue;
      const arr = buckets.get(seg) ?? [];
      arr.push(n);
      buckets.set(seg, arr);
    }
    for (const [, arr] of buckets) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length - 1; i += 1) {
        edges.push({
          id: `cofolder:${arr[i].record.id}->${arr[i + 1].record.id}`,
          fromId: arr[i].record.id,
          toId: arr[i + 1].record.id,
          kind: 'co-folder',
        });
      }
    }
  }

  // 3) Cross-scope: each workspace's index <-> the global workspace_overview node
  //    that represents that same workspace (matched by folder name / file basename).
  const overviewNodes = nodes.filter(
    (n) => n.groupId === 'core' && n.record.isWorkspaceOverview,
  );
  for (const group of groups) {
    if (group.isCore) continue;
    const wsIndex =
      nodes.find((n) => n.groupId === group.id && n.record.isIndex)
      ?? nodes.find((n) => n.groupId === group.id);
    if (!wsIndex) continue;
    const matched = matchOverviewForLabel(overviewNodes, group.label);
    if (matched) {
      edges.push({
        id: `bridge:${wsIndex.record.id}->${matched.record.id}`,
        fromId: wsIndex.record.id,
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
  return (
    fileName === targetLower
    || fileSlug === targetSlug
    || titleSlug === targetSlug
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

    // Same scope + same memory dir: index pairing and same-folder grouping.
    if (record.scope === target.scope && record.memoryDir === target.memoryDir) {
      if (record.isIndex && !target.isIndex) {
        related.push({ record, reason: 'index' });
        seen.add(record.id);
        continue;
      }
      // Workspace overview nodes should NOT be related to each other.
      if (target.isWorkspaceOverview && record.isWorkspaceOverview) continue;
      const seg = dirSegments(record.relativePath)[0];
      if (
        sameSegment
        && seg === sameSegment
        && !isOverviewFolder
        && !record.isWorkspaceOverview
      ) {
        related.push({ record, reason: 'same-folder' });
        seen.add(record.id);
      }
      continue;
    }

    // Cross-scope: workspace index <-> matching global workspace_overview only.
    if (
      target.scope === 'workspace'
      && target.isIndex
      && record.scope === 'global'
      && record.isWorkspaceOverview
      && workspaceLabel
      && overviewMatchesLabel(record, workspaceLabel)
    ) {
      related.push({ record, reason: 'cross-scope' });
      seen.add(record.id);
      continue;
    }
    if (
      target.scope === 'global'
      && target.isWorkspaceOverview
      && record.scope === 'workspace'
      && record.isIndex
      && workspaceLabel
      && overviewMatchesLabel(target, workspaceLabel)
    ) {
      related.push({ record, reason: 'cross-scope' });
      seen.add(record.id);
    }
  }

  return related.slice(0, 12);
};
