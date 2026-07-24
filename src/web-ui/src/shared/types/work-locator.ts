export type WorkScope =
  | { kind: 'global' }
  | { kind: 'workspace'; workspaceId: string };

export interface WorkLocator {
  scope: WorkScope;
  workId: string;
}
