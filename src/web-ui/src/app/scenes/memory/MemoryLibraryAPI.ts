import { api } from '@/infrastructure/api/service-api/ApiClient';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { workspaceAPI, type FileMetadata } from '@/infrastructure/api/service-api/WorkspaceAPI';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('MemoryLibraryAPI');

const MEMORY_FILE = 'MEMORY.md';
const SOUL_FILE = 'SOUL.md';
const USER_FILE = 'USER.md';
const MILESTONES_FILE = 'MILESTONES.md';
const MAX_MEMORY_FILES = 250;
const MAX_MEMORY_LOG_FILES = 3;

export type MemoryScopeKey = 'global' | 'workspace';
export type MemoryRecordType =
  | 'memory'
  | 'soul'
  | 'user'
  | 'milestone'
  | 'host_overview'
  | 'memory_log'
  | 'workspace_overview'
  | 'unknown';

export type MemoryStatus = 'tentative' | 'confirmed' | 'consolidated' | 'archived';
export type MemorySensitivity = 'normal' | 'private' | 'secret';
export type ManualMemoryAction = 'host_scan' | 'workspace_overview' | 'milestone' | 'memory_consolidation';

export interface MemoryStoragePaths {
  userConfigDir: string;
  userDataDir: string;
  cacheRoot: string;
  logsDir: string;
  tempDir: string;
  agenticOsMemoryDir: string;
  agenticOsHostDir: string;
  agenticOsHostOverviewPath: string;
  agenticOsWorkspacesOverviewDir: string;
}

export interface WorkspaceStoragePaths {
  workspaceLocalRoot: string;
  runtimeRoot: string;
  agentsDir: string;
  sessionsDir: string;
  memoryDir: string;
  plansDir: string;
}

export interface MemorySpace {
  scope: MemoryScopeKey;
  label: string;
  memoryDir: string;
  available: boolean;
}

export interface MemoryRecord {
  id: string;
  scope: MemoryScopeKey;
  memoryDir: string;
  groupKey: string;
  path: string;
  relativePath: string;
  title: string;
  description: string;
  type: MemoryRecordType;
  content: string;
  body: string;
  updatedAt?: number;
  size?: number;
  isWorkspaceOverview: boolean;
  workspaceLabel?: string;
  layer?: string;
  status?: MemoryStatus;
  sensitivity?: MemorySensitivity;
  sourceSession?: string;
  tags?: string[];
  lastSeen?: string;
}

export interface AutoMemoryStatus {
  globalEnabled: boolean;
  globalEvery: number;
  workspaceEnabled: boolean;
  workspaceEvery: number;
}

export interface WorkspaceOverviewBinding {
  fileName: string;
  filePath: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRootPath: string;
  workspaceMemoryDir: string;
}

interface FrontmatterResult {
  data: Record<string, string>;
  body: string;
}

interface WorkspaceOverviewTarget {
  groupKey: string;
  workspaceLabel: string;
  workspaceMemoryDir?: string;
}

interface MemoryRecordSource {
  path: string;
  type?: MemoryRecordType;
  groupKey?: string;
}

const normalizePath = (path: string) => path.replace(/\\/g, '/');

const isWorkspaceOverviewDir = (path: string): boolean =>
  normalizePath(path).replace(/\/+$/, '').endsWith('/workspaces_overview');

const isHostOverviewDir = (path: string): boolean =>
  normalizePath(path).replace(/\/+$/, '').endsWith('/host');

const joinPath = (basePath: string, child: string): string => {
  const separator = basePath.includes('\\') ? '\\' : '/';
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${child.replace(/^[\\/]+/, '')}`;
};

const relativePath = (memoryDir: string, path: string): string => {
  const base = normalizePath(memoryDir).replace(/\/+$/, '');
  const target = normalizePath(path);
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : target;
};

const parseFrontmatter = (content: string): FrontmatterResult => {
  if (!content.startsWith('---')) {
    return { data: {}, body: content };
  }

  const lines = content.split(/\r?\n/);
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIndex < 0) {
    return { data: {}, body: content };
  }

  const data: Record<string, string> = {};
  for (const line of lines.slice(1, endIndex)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) {
      data[key] = value;
    }
  }

  return {
    data,
    body: lines.slice(endIndex + 1).join('\n').trimStart(),
  };
};

const titleFromPath = (path: string): string => {
  const fileName = normalizePath(path).split('/').pop() ?? path;
  return fileName.replace(/\.(md|jsonl)$/i, '').replace(/[-_]+/g, ' ');
};

const normalizeRecordType = (relative: string): MemoryRecordType => {
  const fileName = relative.split('/').pop() ?? '';
  if (fileName === MEMORY_FILE) return 'memory';
  if (fileName === SOUL_FILE) return 'soul';
  if (fileName === USER_FILE) return 'user';
  if (fileName === MILESTONES_FILE) return 'milestone';
  return 'unknown';
};

function buildWorkspaceOverviewTargets(bindings: WorkspaceOverviewBinding[]): Map<string, WorkspaceOverviewTarget> {
  const mapping = new Map<string, WorkspaceOverviewTarget>();
  bindings.forEach((binding) => {
    const fileName = binding.fileName.split('/').pop() ?? binding.fileName;
    mapping.set(fileName.toLowerCase(), {
      groupKey: binding.workspaceMemoryDir || binding.workspaceRootPath,
      workspaceLabel: binding.workspaceName || binding.workspaceRootPath.split(/[\\/]/).pop() || 'Workspace',
      workspaceMemoryDir: binding.workspaceMemoryDir,
    });
  });
  return mapping;
}

async function readMetadata(path: string): Promise<Partial<FileMetadata>> {
  try {
    return await workspaceAPI.getFileMetadata(path);
  } catch (error) {
    log.warn('Failed to read memory file metadata', { path, error });
    return {};
  }
}

export class MemoryLibraryAPI {
  async getStoragePaths(): Promise<MemoryStoragePaths> {
    return api.invoke<MemoryStoragePaths>('get_storage_paths', {});
  }

  async getWorkspaceStoragePaths(workspacePath: string): Promise<WorkspaceStoragePaths> {
    return api.invoke<WorkspaceStoragePaths>('get_workspace_storage_paths', { workspacePath });
  }

  async getAutoMemoryStatus(): Promise<AutoMemoryStatus> {
    const [
      globalEnabled,
      globalEvery,
      workspaceEnabled,
      workspaceEvery,
    ] = await Promise.all([
      configManager.getSetting<boolean>('core.ai.auto_memory.global.enabled'),
      configManager.getSetting<number>('core.ai.auto_memory.global.extract_every_eligible_turns'),
      configManager.getSetting<boolean>('core.ai.auto_memory.workspace.enabled'),
      configManager.getSetting<number>('core.ai.auto_memory.workspace.extract_every_eligible_turns'),
    ]);

    return {
      globalEnabled: globalEnabled ?? true,
      globalEvery: globalEvery ?? 6,
      workspaceEnabled: workspaceEnabled ?? true,
      workspaceEvery: workspaceEvery ?? 1,
    };
  }

  async ensureMemorySpace(memoryDir: string): Promise<void> {
    const exists = await systemAPI.checkPathExists(memoryDir);
    if (!exists) {
      await workspaceAPI.createDirectory(memoryDir);
    }

    if (isWorkspaceOverviewDir(memoryDir) || isHostOverviewDir(memoryDir)) {
      if (isHostOverviewDir(memoryDir)) {
        const hostOverviewPath = joinPath(memoryDir, 'host_overview.md');
        const hostOverviewExists = await systemAPI.checkPathExists(hostOverviewPath);
        if (!hostOverviewExists) {
          await workspaceAPI.writeFileContent(memoryDir, hostOverviewPath, '');
        }
      }
      return;
    }

    const memoryPath = joinPath(memoryDir, MEMORY_FILE);
    const memoryExists = await systemAPI.checkPathExists(memoryPath);
    if (!memoryExists) {
      await workspaceAPI.writeFileContent(memoryDir, memoryPath, '');
    }
  }

  async listMemoryRecords(space: MemorySpace): Promise<MemoryRecord[]> {
    if (!space.available) {
      return [];
    }

    await this.ensureMemorySpace(space.memoryDir);
    return this.listAvailableMemoryRecords(space);
  }

  async listExistingMemoryRecords(space: MemorySpace): Promise<MemoryRecord[]> {
    if (!space.available || !await systemAPI.checkPathExists(space.memoryDir)) {
      return [];
    }

    return this.listAvailableMemoryRecords(space);
  }

  private async listAvailableMemoryRecords(space: MemorySpace): Promise<MemoryRecord[]> {
    const workspaceOverviewTargets = isWorkspaceOverviewDir(space.memoryDir)
      ? await this.loadWorkspaceOverviewTargets()
      : new Map<string, WorkspaceOverviewTarget>();
    const files = await this.collectMemoryFiles(space.memoryDir);
    const sortedFiles = files.sort((left, right) => {
      const leftPriority = sortPriorityForMemoryPath(space.memoryDir, left.path, left.type);
      const rightPriority = sortPriorityForMemoryPath(space.memoryDir, right.path, right.type);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return relativePath(space.memoryDir, left.path).localeCompare(relativePath(space.memoryDir, right.path));
    });

    const records = await Promise.all(
      sortedFiles.slice(0, MAX_MEMORY_FILES).map((source) => this.readMemoryRecord(space, source, workspaceOverviewTargets)),
    );

    return records.filter((record): record is MemoryRecord => Boolean(record));
  }

  async saveMemoryRecord(record: MemoryRecord, content: string): Promise<MemoryRecord> {
    await workspaceAPI.writeFileContent(record.memoryDir, record.path, content);
    const refreshed = await this.readMemoryRecord(
      {
        scope: record.scope,
        label: record.scope,
        memoryDir: record.memoryDir,
        available: true,
      },
      {
        path: record.path,
        type: record.type,
        groupKey: record.groupKey,
      },
      new Map(),
    );
    return refreshed ?? { ...record, content };
  }

  async revealMemoryRecord(record: MemoryRecord): Promise<void> {
    await workspaceAPI.revealInExplorer(record.path);
  }

  async revealMemorySpace(space: MemorySpace): Promise<void> {
    await workspaceAPI.revealInExplorer(space.memoryDir);
  }

  async runManualAction(action: ManualMemoryAction): Promise<void> {
    switch (action) {
      case 'host_scan':
        await api.invoke('run_host_scan', {});
        return;
      case 'workspace_overview':
        await api.invoke('run_workspace_overview_refresh', {});
        return;
      case 'milestone':
        await api.invoke('run_global_milestone', {});
        return;
      case 'memory_consolidation':
        await api.invoke('run_memory_consolidation', {
          request: {
            includeGlobal: true,
          },
        });
        return;
      default:
        throw new Error(`Unsupported memory action: ${action satisfies never}`);
    }
  }

  private async loadWorkspaceOverviewTargets(): Promise<Map<string, WorkspaceOverviewTarget>> {
    try {
      const bindings = await api.invoke<WorkspaceOverviewBinding[]>('list_workspace_overview_bindings', {});
      return buildWorkspaceOverviewTargets(bindings);
    } catch (error) {
      log.warn('Failed to load workspace overview targets', { error });
      return new Map();
    }
  }

  private async collectMemoryFiles(memoryDir: string): Promise<MemoryRecordSource[]> {
    const collected: MemoryRecordSource[] = [];

    const visit = async (dir: string): Promise<void> => {
      if (collected.length >= MAX_MEMORY_FILES) {
        return;
      }

      let children;
      try {
        children = await workspaceAPI.getDirectoryChildren(dir);
      } catch (error) {
        log.warn('Failed to list memory directory', { dir, error });
        return;
      }

      for (const child of children) {
        if (collected.length >= MAX_MEMORY_FILES) {
          return;
        }
        if (child.isDirectory) {
          await visit(child.path);
        } else if (
          child.name.toLowerCase().endsWith('.md')
          || child.name.toLowerCase().endsWith('.jsonl')
        ) {
          collected.push({ path: child.path });
        }
      }
    };

    await visit(memoryDir);

    if (isHostOverviewDir(memoryDir)) {
      const hostOverviewPath = joinPath(memoryDir, 'host_overview.md');
      return [{
        path: hostOverviewPath,
        type: 'host_overview',
        groupKey: memoryDir,
      }];
    }

    const logFiles = collected
      .map((entry) => entry.path)
      .filter((path) => normalizePath(path).endsWith('.jsonl'))
      .sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
    const newestLogFiles = new Set(
      logFiles.slice(Math.max(0, logFiles.length - MAX_MEMORY_LOG_FILES)).map(normalizePath),
    );

    return collected.filter((entry) => {
      const normalized = normalizePath(entry.path);
      const rel = relativePath(memoryDir, entry.path);
      if (normalized.endsWith('.jsonl')) {
        return newestLogFiles.has(normalized);
      }
      if (isWorkspaceOverviewDir(memoryDir)) {
        return normalized.endsWith('.md');
      }
      return !rel.includes('/') && [MEMORY_FILE, SOUL_FILE, USER_FILE, MILESTONES_FILE].includes(rel);
    });
  }

  private async readMemoryRecord(
    space: MemorySpace,
    source: MemoryRecordSource,
    workspaceOverviewTargets: Map<string, WorkspaceOverviewTarget>,
  ): Promise<MemoryRecord | null> {
    const path = source.path;
    try {
      const content = await workspaceAPI.readFileContent(path);
      const metadata = await readMetadata(path);
      const rel = relativePath(space.memoryDir, path);
      const isLog = rel.toLowerCase().endsWith('.jsonl');
      const frontmatter = isLog ? { data: {}, body: content } : parseFrontmatter(content);
      const type = source.type ?? (isLog
        ? 'memory_log'
        : isWorkspaceOverviewDir(space.memoryDir)
          ? 'workspace_overview'
          : normalizeRecordType(rel));
      const overviewFileName = type === 'workspace_overview'
        ? (rel.split('/').pop() ?? '').toLowerCase()
        : undefined;
      const overviewTarget = overviewFileName ? workspaceOverviewTargets.get(overviewFileName) : undefined;
      const workspaceLabel = overviewTarget?.workspaceLabel;
      const title = type === 'workspace_overview'
        ? `${workspaceLabel ?? titleFromPath(rel)} overview`
        : type === 'host_overview'
          ? 'Host overview'
          : frontmatter.data.name || titleFromPath(rel);

      const tagsRaw = frontmatter.data.tags ?? '';
      const tags = tagsRaw
        ? tagsRaw
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
        : undefined;

      return {
        id: `${space.scope}:${rel}`,
        scope: space.scope,
        memoryDir: space.memoryDir,
        groupKey: source.groupKey ?? (type === 'workspace_overview'
          ? overviewTarget?.groupKey ?? normalizePath(path)
          : space.memoryDir),
        path,
        relativePath: rel,
        title,
        description: frontmatter.data.description || firstContentLine(frontmatter.body),
        type,
        content,
        body: frontmatter.body,
        updatedAt: typeof metadata.modified === 'number' ? metadata.modified : undefined,
        size: typeof metadata.size === 'number' ? metadata.size : undefined,
        isWorkspaceOverview: type === 'workspace_overview',
        workspaceLabel,
        layer: frontmatter.data.layer,
        status: frontmatter.data.status as MemoryStatus | undefined,
        sensitivity: frontmatter.data.sensitivity as MemorySensitivity | undefined,
        sourceSession: frontmatter.data.source_session,
        tags,
        lastSeen: frontmatter.data.last_seen,
      };
    } catch (error) {
      log.warn('Failed to read memory record', { path, error });
      return null;
    }
  }
}

function firstContentLine(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean) ?? '';
}

function sortPriorityForMemoryPath(
  memoryDir: string,
  path: string,
  type?: MemoryRecordType,
): number {
  if (type === 'host_overview') return 4;
  if (type === 'workspace_overview') return 4;
  const rel = relativePath(memoryDir, path);
  if (rel === MEMORY_FILE) return 0;
  if (rel === SOUL_FILE) return 1;
  if (rel === USER_FILE) return 2;
  if (rel === MILESTONES_FILE) return 3;
  if (rel.toLowerCase().endsWith('.jsonl')) return 5;
  return 4;
}

export const memoryLibraryAPI = new MemoryLibraryAPI();
