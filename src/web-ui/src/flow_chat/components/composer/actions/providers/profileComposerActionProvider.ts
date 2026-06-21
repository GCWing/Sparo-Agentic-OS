import type { SessionComposerActionProviderId } from '@/app/session-profiles';
import type { ComposerActionProvider } from './composerActionProviderTypes';

export type ProfileComposerActionProvider = ComposerActionProvider & {
  id: SessionComposerActionProviderId;
};

const profileComposerActionProviderRegistry = new Map<
  SessionComposerActionProviderId,
  ProfileComposerActionProvider
>();

export function registerProfileComposerActionProvider(
  provider: ProfileComposerActionProvider,
): void {
  profileComposerActionProviderRegistry.set(provider.id, provider);
}

export function unregisterProfileComposerActionProvider(
  providerId: SessionComposerActionProviderId,
): void {
  profileComposerActionProviderRegistry.delete(providerId);
}

export function getProfileComposerActionProvider(
  providerId: SessionComposerActionProviderId,
): ComposerActionProvider | null {
  return profileComposerActionProviderRegistry.get(providerId) ?? null;
}
