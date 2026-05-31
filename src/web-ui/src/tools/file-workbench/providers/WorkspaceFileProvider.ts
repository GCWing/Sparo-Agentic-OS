import { workspaceAPI } from '@/infrastructure/api';
import type { ExplorerNodeDto } from '@/infrastructure/api/service-api/tauri-commands';
import { fileEntryFromFsEntry } from '../services/fileClassification';
import type { FileEntry, FileScope } from '../types';

function workspaceScope(root: string): FileScope {
  return { kind: 'workspace', root };
}

function nodeToEntry(node: ExplorerNodeDto, root: string): FileEntry {
  return fileEntryFromFsEntry({
    path: node.path,
    name: node.name,
    kind: node.isDirectory ? 'dir' : 'file',
    size: node.size ?? 0,
    modified: typeof node.lastModified === 'number'
      ? new Date(node.lastModified).toISOString()
      : undefined,
    readonly: false,
    hidden: node.name.startsWith('.'),
  }, workspaceScope(root));
}

export class WorkspaceFileProvider {
  constructor(private readonly root: string) {}

  async listDir(path: string): Promise<FileEntry[]> {
    const nodes = await workspaceAPI.explorerGetChildren(path);
    return nodes.map((node) => nodeToEntry(node, this.root));
  }

  async stat(path: string): Promise<FileEntry> {
    const metadata = await workspaceAPI.getFileMetadata(path);
    const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
    return fileEntryFromFsEntry({
      path: metadata.path,
      name,
      kind: metadata.isDir ? 'dir' : 'file',
      size: metadata.size,
      modified: metadata.modified ? new Date(metadata.modified).toISOString() : undefined,
      readonly: false,
      hidden: name.startsWith('.'),
    }, workspaceScope(this.root));
  }

  readText(path: string): Promise<string> {
    return workspaceAPI.readFileContent(path);
  }
}
