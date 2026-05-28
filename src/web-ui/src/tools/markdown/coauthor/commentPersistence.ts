import { api, workspaceAPI } from '@/infrastructure/api';
import type { MarkdownEditOp, MarkdownEditProposal } from './protocol';
import { sha256Hex } from './hash';

export interface PersistedCoauthorComment {
  id: string;
  proposalId: string;
  filePath?: string;
  sourceHash: string;
  from: Extract<MarkdownEditOp, { type: 'comment' }>['from'];
  to: Extract<MarkdownEditOp, { type: 'comment' }>['to'];
  message: string;
  severity?: 'info' | 'warning' | 'error';
  createdAt: number;
}

interface ProjectStoragePaths {
  projectRoot: string;
}

function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^([A-Za-z]):\//, '$1:/');
}

async function getCommentSidecarPath(workspacePath: string, filePath?: string): Promise<string> {
  const paths = await api.invoke<ProjectStoragePaths>('get_project_storage_paths', { workspacePath });
  const docHash = await sha256Hex(filePath || workspacePath);
  return joinPath(paths.projectRoot, 'coauthor', 'comments', `${docHash}.json`);
}

export async function persistAcceptedComments(
  workspacePath: string | undefined,
  proposal: MarkdownEditProposal,
  opIds: string[],
): Promise<void> {
  if (!workspacePath || opIds.length === 0) {
    return;
  }

  const comments = proposal.ops.filter((op): op is Extract<MarkdownEditOp, { type: 'comment' }> => (
    op.type === 'comment' && opIds.includes(op.id)
  ));
  if (comments.length === 0) {
    return;
  }

  const sidecarPath = await getCommentSidecarPath(workspacePath, proposal.filePath);
  const sidecarDir = sidecarPath.slice(0, sidecarPath.lastIndexOf('/'));

  try {
    await workspaceAPI.createDirectory(sidecarDir);
  } catch {
    // Directory may already exist.
  }

  let existing: PersistedCoauthorComment[] = [];
  try {
    existing = JSON.parse(await workspaceAPI.readFileContent(sidecarPath)) as PersistedCoauthorComment[];
  } catch {
    existing = [];
  }

  const now = Date.now();
  const existingIds = new Set(existing.map(comment => comment.id));
  const next = [
    ...existing,
    ...comments
      .filter(comment => !existingIds.has(comment.id))
      .map(comment => ({
        id: comment.id,
        proposalId: proposal.proposalId,
        filePath: proposal.filePath,
        sourceHash: proposal.sourceHash,
        from: comment.from,
        to: comment.to,
        message: comment.message,
        severity: comment.severity,
        createdAt: now,
      })),
  ];

  await workspaceAPI.writeFileContent(workspacePath, sidecarPath, `${JSON.stringify(next, null, 2)}\n`);
}

export async function readPersistedComments(
  workspacePath: string | undefined,
  filePath: string | undefined,
): Promise<PersistedCoauthorComment[]> {
  if (!workspacePath || !filePath) {
    return [];
  }

  try {
    const sidecarPath = await getCommentSidecarPath(workspacePath, filePath);
    const raw = await workspaceAPI.readFileContent(sidecarPath);
    const parsed = JSON.parse(raw) as PersistedCoauthorComment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
