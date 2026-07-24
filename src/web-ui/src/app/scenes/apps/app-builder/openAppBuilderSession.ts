import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import { SESSION_DESCRIPTORS } from '@/flow_chat/domain/sessionDescriptor';
import { openBoundAgentSession } from '@/flow_chat/services/boundAgentSessionService';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import {
  intelligentAppAPI,
  type AppDraftRecord,
  type CreatedIntelligentApp,
  type IntelligentAppRecord,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { systemAppScope, type AppScope } from '@/shared/types/app-scope';
import { buildAppBuilderWorkRequest } from './appBuilderWork';

function getWorkSession(work: WorkRecord): {
  locator: NonNullable<WorkRecord['sessionRefs'][number]['locator']>;
  workspacePath?: string | null;
} {
  const surface = work.primarySurface.kind === 'work_session'
    ? work.primarySurface
    : work.surfaces.find((candidate) => candidate.kind === 'work_session');
  if (!surface || surface.kind !== 'work_session') {
    throw new Error(`App Builder Work has no WorkSession: ${work.id}`);
  }
  const sessionRef = work.sessionRefs.find((candidate) => candidate.sessionId === surface.sessionId);
  if (!sessionRef?.locator) {
    throw new Error(`App Builder WorkSession has no locator: ${surface.sessionId}`);
  }
  return {
    locator: sessionRef.locator,
    workspacePath: sessionRef?.workspacePath,
  };
}

export interface OpenAppBuilderDraftRequest {
  app: IntelligentAppRecord;
  draft: AppDraftRecord;
  scope?: AppScope;
  initialInstruction?: string;
  displayInstruction?: string;
}

/** Opens the Builder bound to one mutable Draft; it never binds to a Release. */
export async function openAppBuilderSession(
  request: OpenAppBuilderDraftRequest,
): Promise<string> {
  const scope = request.scope ?? systemAppScope();
  const { work } = await useWorkStore.getState().resolveComponentWork(
    buildAppBuilderWorkRequest(request, scope),
  );
  const workSession = getWorkSession(work);
  const session = await openBoundAgentSession({
    descriptor: SESSION_DESCRIPTORS.appBuilder,
    sessionName: request.app.displayName,
    domain: workSession.locator.domain,
    existingSession: workSession,
    context: { kind: 'work', workId: work.id },
    binding: {
      schemaVersion: 1,
      intent: {
        agentType: 'AppBuilder',
        mode: request.draft.baseReleaseId ? 'edit' : 'create',
      },
      subject: {
        kind: 'builder-draft',
        id: request.draft.draftId,
        title: request.app.displayName,
      },
      surface: {
        contentType: 'app-builder',
        title: request.app.displayName,
        data: {
          draftId: request.draft.draftId,
          appId: request.app.appId,
          slotId: request.app.slotId,
          baseReleaseId: request.draft.baseReleaseId ?? null,
          rebaseContext: request.draft.rebaseContext ?? null,
        },
        duplicateKey: `app-builder-draft:${request.draft.draftId}`,
      },
      scope,
      executionContext: {
        workId: work.id,
      },
      openedFrom: 'apps-center',
      updatedAt: Date.now(),
    },
    customMetadata: {
      appBuilderDraft: {
        draftId: request.draft.draftId,
      },
    },
  });

  if (!session) {
    throw new Error(`Unable to open App Builder draft: ${request.draft.draftId}`);
  }

  if (request.initialInstruction?.trim()) {
    await flowChatManager.sendMessage(
      request.initialInstruction.trim(),
      session.sessionId,
      request.displayInstruction?.trim() || request.initialInstruction.trim(),
      'AppBuilder',
      'AppBuilder',
      {
        triggerSource: 'desktop_ui',
        metadata: {
          appBuilderDraftContext: {
            draftId: request.draft.draftId,
          },
        },
      },
    );
  }

  return session.sessionId;
}

export interface CreateAndOpenAppBuilderRequest {
  displayName?: string;
  description?: string;
  scope?: AppScope;
}

/** Natural-language creation entry used by Apps Center and global search. */
export async function createAndOpenAppBuilder(
  request: CreateAndOpenAppBuilderRequest = {},
): Promise<CreatedIntelligentApp> {
  const created = await intelligentAppAPI.createApp({
    displayName: request.displayName,
    description: request.description,
  });
  const instruction = request.description?.trim();
  await openAppBuilderSession({
    ...created,
    scope: request.scope,
    initialInstruction: instruction
      ? `Build this intelligent app from the user's description:\n\n${instruction}`
      : undefined,
    displayInstruction: instruction,
  });
  return created;
}
