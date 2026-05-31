import { SystemFileProvider } from './SystemFileProvider';
import { WorkspaceFileProvider } from './WorkspaceFileProvider';
import type { FileScope } from '../types';

export function createFileProvider(scope: FileScope): SystemFileProvider | WorkspaceFileProvider {
  if (scope.kind === 'workspace') {
    return new WorkspaceFileProvider(scope.root);
  }
  return new SystemFileProvider();
}
