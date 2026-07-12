import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type { AppIconSpec } from '@/shared/types/app-manifest';
import type { ProductAppHostSurface } from './ProductAppRuntimeHostAPI';
import { createTauriCommandError } from '../errors/TauriCommandError';
import { api } from './ApiClient';

/**
 * Intelligent App lifecycle contract.
 *
 * App is identity and lineage, Draft is the only mutable object, Release is an
 * immutable artifact, and Activation selects the Release used by new Work.
 * Runtime code must never infer a Release from appId alone.
 */

export type IntelligentAppOwnerKind = 'system' | 'user' | 'organization';
export type AppVariantState = 'active' | 'disabled' | 'available';

export interface IntelligentAppOwner {
  kind: IntelligentAppOwnerKind;
  ownerId?: string | null;
}

export interface DerivedAppRef {
  appId: string;
  releaseId: string;
}

export interface IntelligentAppRecord {
  appId: string;
  slotId: string;
  displayName: string;
  description?: string | null;
  owner: IntelligentAppOwner;
  derivedFrom?: DerivedAppRef | null;
  createdAtMs: number;
}

export type AppReleaseProvenance =
  | 'system'
  | 'user'
  | 'aiGenerated'
  | 'organization'
  | 'external';

export type AppRuntimeLaunchKind = 'agentSession' | 'applicationSurface' | 'appBuilder';
export type AppRuntimeScopeRequirement = 'systemAllowed' | 'workspaceOptional' | 'workspaceRequired';
export type AppRuntimeSurfaceMode = 'chatPrimary' | 'sidecarLinked' | 'immersivePrimary' | 'embeddedObject';
export type AppRuntimeWorkMultiplicity = 'multiple' | 'singleton';

export interface AppRuntimeLaunch {
  kind: AppRuntimeLaunchKind;
  targetId: string;
  scopeRequirement: AppRuntimeScopeRequirement;
  agentType?: string | null;
  surfaceId?: string | null;
}

export interface AppRuntimeSurfaceRef {
  componentId: string;
  surfaceId?: string | null;
}

export interface AppReleaseRuntime {
  launch?: AppRuntimeLaunch | null;
  primarySurface?: AppRuntimeSurfaceRef | null;
  primarySurfaceMode?: AppRuntimeSurfaceMode | null;
  workMultiplicity: AppRuntimeWorkMultiplicity;
  icon: AppIconSpec;
  category: string;
  tags: string[];
}

export interface AppReleaseRecord {
  releaseId: string;
  appId: string;
  slotId: string;
  version: string;
  artifactDigest: string;
  parentReleaseId?: string | null;
  componentLockDigest: string;
  configRevision: string;
  runtimeCompatibility: string;
  capabilityFingerprint: string;
  dataSchemaVersion: string;
  runtime: AppReleaseRuntime;
  provenance: AppReleaseProvenance;
  evaluationReportDigest: string;
  label?: string | null;
  notes?: string | null;
  signature?: string | null;
  upstreamAppId?: string | null;
  upstreamBaseReleaseId?: string | null;
  createdAtMs: number;
}

export interface AppDraftRecord {
  draftId: string;
  appId: string;
  baseReleaseId?: string | null;
  rebaseContext?: {
    upstreamAppId: string;
    baseReleaseId: string;
    targetReleaseId: string;
  } | null;
  path: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AppActivationRecord {
  slotId: string;
  selectedAppId: string;
  activeReleaseId: string;
  previousReleaseId?: string | null;
  enabled: boolean;
}

export interface AppVariantRecord {
  app: IntelligentAppRecord;
  releases: AppReleaseRecord[];
  latestRelease?: AppReleaseRecord | null;
  upstreamBaseReleaseId?: string | null;
  upstreamLatestReleaseId?: string | null;
  upstreamUpdateAvailable: boolean;
  state: AppVariantState;
}

export interface AppSlotRecord {
  slotId: string;
  displayName: string;
  activation?: AppActivationRecord | null;
  variants: AppVariantRecord[];
}

export interface IntelligentAppCatalog {
  slots: AppSlotRecord[];
  drafts: AppDraftRecord[];
}

export interface CreatedIntelligentApp {
  app: IntelligentAppRecord;
  draft: AppDraftRecord;
}

export interface PublishedAppDraft {
  app: IntelligentAppRecord;
  release: AppReleaseRecord;
}

export interface ResolvedAppDraft {
  draft: AppDraftRecord;
  sourcePath: string;
}

export interface AppDraftPreview {
  previewSessionId: string;
  ephemeralArtifactId: string;
  hostSurface: ProductAppHostSurface;
  runtimeContext: ProductAppRuntimeContext;
}

export interface CreateIntelligentAppRequest {
  appId?: string;
  displayName?: string;
  description?: string;
  slotId?: string;
}

export interface ForkIntelligentAppRequest {
  sourceReleaseId: string;
  newAppId?: string;
  displayName?: string;
  description?: string;
  slotId?: string;
}

export interface PublishAppDraftRequest {
  draftId: string;
  version: string;
  label?: string;
  notes?: string;
}

export interface ActivateAppReleaseRequest {
  slotId: string;
  appId: string;
  releaseId: string;
}

export interface ActiveAppRef {
  slotId: string;
  appId: string;
  releaseId: string;
  configRevision: string;
  dataSchemaVersion: string;
  runtime: AppReleaseRuntime;
}

export interface AppReleaseCapabilityReview {
  appId: string;
  releaseId: string;
  capabilityFingerprint: string;
  capabilities: string[];
  approved: boolean;
  requiresApproval: boolean;
}

function commandError(
  command: string,
  error: unknown,
  request?: unknown,
): Error {
  return createTauriCommandError(command, error, request);
}

export class IntelligentAppAPI {
  async listCatalog(): Promise<IntelligentAppCatalog> {
    try {
      return await api.invoke<IntelligentAppCatalog>('list_app_catalog', {
        request: {},
      });
    } catch (error) {
      throw commandError('list_app_catalog', error);
    }
  }

  async createApp(
    request: CreateIntelligentAppRequest = {},
  ): Promise<CreatedIntelligentApp> {
    try {
      return await api.invoke<CreatedIntelligentApp>('create_intelligent_app', {
        request,
      });
    } catch (error) {
      throw commandError('create_intelligent_app', error, request);
    }
  }

  async forkApp(request: ForkIntelligentAppRequest): Promise<CreatedIntelligentApp> {
    try {
      return await api.invoke<CreatedIntelligentApp>('fork_intelligent_app', {
        request,
      });
    } catch (error) {
      throw commandError('fork_intelligent_app', error, request);
    }
  }

  async createDraft(appId: string, baseReleaseId?: string): Promise<AppDraftRecord> {
    const request = { appId, baseReleaseId };
    try {
      return await api.invoke<AppDraftRecord>('create_app_draft', { request });
    } catch (error) {
      throw commandError('create_app_draft', error, request);
    }
  }

  async createRebaseDraft(request: {
    appId: string;
    currentReleaseId: string;
    targetUpstreamReleaseId: string;
  }): Promise<AppDraftRecord> {
    try {
      return await api.invoke<AppDraftRecord>('create_app_rebase_draft', { request });
    } catch (error) {
      throw commandError('create_app_rebase_draft', error, request);
    }
  }

  async resolveDraft(draftId: string): Promise<ResolvedAppDraft> {
    const request = { draftId };
    try {
      return await api.invoke<ResolvedAppDraft>('resolve_app_draft', { request });
    } catch (error) {
      throw commandError('resolve_app_draft', error, request);
    }
  }

  async resolveDraftPreview(request: {
    draftId: string;
    theme?: string;
    locale?: string;
    workspacePath?: string;
  }): Promise<AppDraftPreview> {
    try {
      return await api.invoke<AppDraftPreview>('resolve_intelligent_app_draft_preview', { request });
    } catch (error) {
      throw commandError('resolve_intelligent_app_draft_preview', error, request);
    }
  }

  async closeDraftPreview(previewSessionId: string): Promise<void> {
    const request = { previewSessionId };
    try {
      await api.invoke('close_intelligent_app_draft_preview', { request });
    } catch (error) {
      throw commandError('close_intelligent_app_draft_preview', error, request);
    }
  }

  async publishDraft(request: PublishAppDraftRequest): Promise<PublishedAppDraft> {
    try {
      return await api.invoke<PublishedAppDraft>('publish_app_draft', { request });
    } catch (error) {
      throw commandError('publish_app_draft', error, request);
    }
  }

  async activateRelease(
    request: ActivateAppReleaseRequest,
  ): Promise<AppActivationRecord> {
    try {
      return await api.invoke<AppActivationRecord>('activate_app_release', { request });
    } catch (error) {
      throw commandError('activate_app_release', error, request);
    }
  }

  async getReleaseCapabilityReview(
    appId: string,
    releaseId: string,
  ): Promise<AppReleaseCapabilityReview> {
    const request = { appId, releaseId };
    try {
      return await api.invoke<AppReleaseCapabilityReview>(
        'get_app_release_capability_review',
        { request },
      );
    } catch (error) {
      throw commandError('get_app_release_capability_review', error, request);
    }
  }

  async approveCapabilities(request: {
    appId: string;
    releaseId: string;
  }): Promise<void> {
    try {
      await api.invoke('approve_app_release_capabilities', { request });
    } catch (error) {
      throw commandError('approve_app_release_capabilities', error, request);
    }
  }

  async rollbackActivation(slotId: string): Promise<AppActivationRecord> {
    const request = { slotId };
    try {
      return await api.invoke<AppActivationRecord>('rollback_app_activation', { request });
    } catch (error) {
      throw commandError('rollback_app_activation', error, request);
    }
  }

  async deactivateSlot(slotId: string): Promise<void> {
    const request = { slotId };
    try {
      await api.invoke('deactivate_app_slot', { request });
    } catch (error) {
      throw commandError('deactivate_app_slot', error, request);
    }
  }

  async removeApp(appId: string): Promise<void> {
    const request = { appId };
    try {
      await api.invoke('remove_intelligent_app', { request });
    } catch (error) {
      throw commandError('remove_intelligent_app', error, request);
    }
  }

  activeRef(slot: AppSlotRecord): ActiveAppRef | null {
    const activation = slot.activation;
    if (!activation?.enabled) return null;
    const variant = slot.variants.find(({ app }) => app.appId === activation.selectedAppId);
    const release = variant?.releases.find(
      ({ releaseId }) => releaseId === activation.activeReleaseId,
    );
    if (!variant || !release) return null;
    return {
      slotId: slot.slotId,
      appId: variant.app.appId,
      releaseId: release.releaseId,
      configRevision: release.configRevision,
      dataSchemaVersion: release.dataSchemaVersion,
      runtime: release.runtime,
    };
  }
}

export const intelligentAppAPI = new IntelligentAppAPI();
