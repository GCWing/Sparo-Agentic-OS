import YAML from 'yaml';
import { api, workspaceAPI } from '@/infrastructure/api';
import type { MarkdownDocumentProfile } from './protocol';
import { sha256Hex } from './hash';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface ProfileResolution {
  profile?: MarkdownDocumentProfile;
  source: 'frontMatter' | 'sidecar' | 'global' | 'none';
}

export function resolveMarkdownDocumentProfile(
  markdown: string,
  options: { sidecar?: MarkdownDocumentProfile; globalDefault?: MarkdownDocumentProfile; disabled?: boolean } = {},
): ProfileResolution {
  if (options.disabled) {
    return { source: 'none' };
  }

  const match = markdown.match(FRONT_MATTER_RE);
  if (match?.[1]) {
    try {
      const parsed = YAML.parse(match[1]) as { coauthor?: MarkdownDocumentProfile } | null;
      if (parsed?.coauthor && typeof parsed.coauthor === 'object') {
        return { profile: parsed.coauthor, source: 'frontMatter' };
      }
    } catch {
      // Invalid front matter should not block editing.
    }
  }

  if (options.sidecar) {
    return { profile: options.sidecar, source: 'sidecar' };
  }

  if (options.globalDefault) {
    return { profile: options.globalDefault, source: 'global' };
  }

  return { source: 'none' };
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

export async function readMarkdownDocumentProfileSidecar(
  workspacePath: string | undefined,
  filePath: string | undefined,
): Promise<MarkdownDocumentProfile | undefined> {
  if (!workspacePath || !filePath) {
    return undefined;
  }

  try {
    const paths = await api.invoke<ProjectStoragePaths>('get_project_storage_paths', { workspacePath });
    const docHash = await sha256Hex(filePath);
    const profilePath = joinPath(paths.projectRoot, 'coauthor', 'profiles', `${docHash}.json`);
    const raw = await workspaceAPI.readFileContent(profilePath);
    const parsed = JSON.parse(raw) as MarkdownDocumentProfile;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}
