import type { WorkScope } from './work-locator';

export interface WorkObjectLocator {
  scope: WorkScope;
  objectId: string;
}
