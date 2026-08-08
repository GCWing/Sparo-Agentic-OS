import type { WorkspaceSurface } from '@/app/navigation/workspaceSurfaceTypes';
import type { AuxiliarySurfaceHostKey } from './types';

export function homeAuxiliaryHostKey(sessionId: string): AuxiliarySurfaceHostKey {
  return `home:${sessionId}`;
}

export function sessionAuxiliaryHostKey(sessionId: string): AuxiliarySurfaceHostKey {
  return `session:${sessionId}`;
}

export function resolveAuxiliaryHostKey(
  surface: WorkspaceSurface,
  currentOsSessionId: string | null,
): AuxiliarySurfaceHostKey | null {
  if (surface.kind === 'session') {
    return sessionAuxiliaryHostKey(surface.sessionId);
  }
  if (surface.kind === 'agentic-os-home' && currentOsSessionId) {
    return homeAuxiliaryHostKey(currentOsSessionId);
  }
  return null;
}

export function auxiliaryHostKeysForSession(sessionId: string): AuxiliarySurfaceHostKey[] {
  return [homeAuxiliaryHostKey(sessionId), sessionAuxiliaryHostKey(sessionId)];
}
