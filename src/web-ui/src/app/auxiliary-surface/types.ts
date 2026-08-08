import type { CanvasItemDescriptor } from '@/app/components/panels/content-canvas/types';

export type AuxiliarySurfaceHostKey = `home:${string}` | `session:${string}`;
export type AuxiliarySurfacePresentation = 'closed' | 'docked' | 'scene-focus';
export type AuxiliarySurfaceDefaultVisibility = 'collapsed' | 'visible';
export type AuxiliarySurfaceUserDisposition = 'default' | 'opened' | 'closed';
export type AuxiliarySurfaceReveal = 'explicit' | 'policy' | 'preserve';

export type AuxiliaryItemDescriptor = CanvasItemDescriptor;

export interface OpenAuxiliaryItemCommand {
  hostKey: AuxiliarySurfaceHostKey;
  item: AuxiliaryItemDescriptor;
  reveal?: AuxiliarySurfaceReveal;
}

export interface AuxiliarySurfaceHostState {
  presentation: AuxiliarySurfacePresentation;
  sceneFocusReturnPresentation: 'closed' | 'docked' | null;
  userDisposition: AuxiliarySurfaceUserDisposition;
  defaultVisibility: AuxiliarySurfaceDefaultVisibility;
  configuredProfileId: string | null;
  entryPolicyApplied: boolean;
  initializedProfileIds: readonly string[];
}
