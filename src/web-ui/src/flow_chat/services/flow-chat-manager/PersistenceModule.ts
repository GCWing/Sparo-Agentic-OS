/**
 * Persistence module
 * Handles persistence operations for dialog turn saving and metadata management
 */

import { createLogger } from '@/shared/utils/logger';
import type { FlowChatContext, DialogTurn } from './types';
import { buildSessionMetadata } from '../../utils/sessionMetadata';
import { finalizeFlowTurn } from '../../runtime/finalizers';

const log = createLogger('PersistenceModule');
const metadataSaveTimers = new WeakMap<FlowChatContext, Map<string, ReturnType<typeof setTimeout>>>();

function scheduleMicrotask(work: () => void): void {
  const guardedWork = () => {
    try {
      work();
    } catch (error) {
      log.warn('Queued persistence task failed', { error });
    }
  };

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(guardedWork);
    return;
  }
  Promise.resolve().then(guardedWork);
}

function getMetadataSaveTimers(context: FlowChatContext): Map<string, ReturnType<typeof setTimeout>> {
  let timers = metadataSaveTimers.get(context);
  if (!timers) {
    timers = new Map();
    metadataSaveTimers.set(context, timers);
  }
  return timers;
}

function scheduleSessionMetadataUpdate(
  context: FlowChatContext,
  sessionId: string,
  delay: number = 750
): void {
  const timers = getMetadataSaveTimers(context);
  const existing = timers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    timers.delete(sessionId);
    updateSessionMetadata(context, sessionId).catch(error => {
      log.warn('Queued metadata save failed', { sessionId, error });
    });
  }, delay);

  timers.set(sessionId, timer);
}

function isTransientSession(session: { isTransient?: boolean } | undefined): boolean {
  return session?.isTransient === true;
}

function requireWorkspacePath(
  sessionId: string,
  workspacePath?: string,
  storageScope?: import('@/shared/types/session-history').SessionStorageScope
): string {
  if (storageScope === 'agentic_os') {
    return workspacePath || '';
  }
  if (!workspacePath) {
    throw new Error(`Workspace path is required for session: ${sessionId}`);
  }
  return workspacePath;
}

async function runSerialDialogTurnSave(
  context: FlowChatContext,
  sessionId: string,
  turnId: string
): Promise<void> {
  const key = `${sessionId}:${turnId}`;
  const existingTask = context.turnSaveInFlight.get(key);
  if (existingTask) {
    context.turnSavePending.add(key);
    await existingTask;
    return;
  }

  const task = (async () => {
    try {
      do {
        context.turnSavePending.delete(key);
        await performSaveDialogTurnToDisk(context, sessionId, turnId);
      } while (context.turnSavePending.has(key));
    } finally {
      context.turnSaveInFlight.delete(key);
      context.turnSavePending.delete(key);
    }
  })();

  context.turnSaveInFlight.set(key, task);
  await task;
}

/**
 * Calculate content hash for dialog turn (for deduplication)
 */
export function calculateTurnHash(dialogTurn: DialogTurn): string {
  let hash = 0;

  const pushPart = (value: string | number | boolean | null | undefined) => {
    const part = String(value ?? '');
    for (let i = 0; i < part.length; i++) {
      const char = part.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    hash = ((hash << 5) - hash) + 31;
    hash |= 0;
  };

  pushPart(dialogTurn.status);
  pushPart(dialogTurn.error);
  pushPart(dialogTurn.endTime);
  pushPart(dialogTurn.modelRounds.length);

  for (const round of dialogTurn.modelRounds) {
    pushPart(round.id);
    pushPart(round.status);
    pushPart(round.isStreaming);
    pushPart(round.items.length);

    for (const item of round.items) {
      pushPart(item.id);
      pushPart(item.type);
      pushPart(item.status);

      if (item.type === 'text' || item.type === 'thinking') {
        pushPart((item as { content?: string }).content?.length || 0);
      } else if (item.type === 'tool') {
        const toolItem = item as {
          toolName?: string;
          runtime?: { inputPhase?: string; partialInput?: unknown };
          toolResult?: { success?: boolean; error?: string; duration_ms?: number };
          _contentSize?: number;
        };
        pushPart(toolItem.toolName);
        pushPart(toolItem.runtime?.inputPhase);
        pushPart(
          toolItem.runtime?.partialInput && typeof toolItem.runtime.partialInput === 'object'
            ? Object.keys(toolItem.runtime.partialInput).length
            : 0
        );
        pushPart(toolItem._contentSize || 0);
        pushPart(toolItem.toolResult?.success);
        pushPart(toolItem.toolResult?.error);
        pushPart(toolItem.toolResult?.duration_ms);
      }
    }
  }

  if (hash === 0) {
    pushPart(dialogTurn.id);
  }

  return hash.toString(36);
}

/**
 * Debounced save dialog turn
 * Only executes the last call when called multiple times in a short period
 */
export function debouncedSaveDialogTurn(
  context: FlowChatContext,
  sessionId: string,
  turnId: string,
  delay: number = 2000
): void {
  const key = `${sessionId}:${turnId}`;
  
  const existingTimer = context.saveDebouncers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  const timer = setTimeout(() => {
    saveDialogTurnToDisk(context, sessionId, turnId).catch(error => {
      log.warn('Debounced save failed', { sessionId, turnId, error });
    });
    context.saveDebouncers.delete(key);
  }, delay);
  
  context.saveDebouncers.set(key, timer);
}

/**
 * Immediately save dialog turn (skip debounce)
 * Used for critical moments like round completion, tool execution completion, etc.
 */
export function immediateSaveDialogTurn(
  context: FlowChatContext,
  sessionId: string,
  turnId: string,
  skipDuplicateCheck: boolean = false
): void {
  const key = `${sessionId}:${turnId}`;
  
  const existingTimer = context.saveDebouncers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    context.saveDebouncers.delete(key);
  }
  
  scheduleMicrotask(() => {
    if (!skipDuplicateCheck) {
      const session = context.flowChatStore.getState().sessions.get(sessionId);
      if (session) {
        const dialogTurn = session.dialogTurns.find(turn => turn.id === turnId);
        if (dialogTurn) {
          const currentHash = calculateTurnHash(dialogTurn);
          const lastHash = context.lastSaveHashes.get(key);
          const lastTimestamp = context.lastSaveTimestamps.get(key) || 0;
          const now = Date.now();

          if (lastHash === currentHash && (now - lastTimestamp) < 5000) {
            return;
          }

          context.lastSaveHashes.set(key, currentHash);
          context.lastSaveTimestamps.set(key, now);
        }
      }
    }

    saveDialogTurnToDisk(context, sessionId, turnId).catch(error => {
      log.warn('Immediate save failed', { sessionId, turnId, error });
    });
  });
}

/**
 * Clean up session save state
 * Called when session or turn is deleted
 */
export function cleanupSaveState(
  context: FlowChatContext,
  sessionId: string,
  turnId?: string
): void {
  if (turnId) {
    const key = `${sessionId}:${turnId}`;
    const timer = context.saveDebouncers.get(key);
    if (timer) {
      clearTimeout(timer);
      context.saveDebouncers.delete(key);
    }
    context.lastSaveTimestamps.delete(key);
    context.lastSaveHashes.delete(key);
    context.turnSavePending.delete(key);
    context.turnSaveInFlight.delete(key);
  } else {
    const metadataTimers = getMetadataSaveTimers(context);
    const metadataTimer = metadataTimers.get(sessionId);
    if (metadataTimer) {
      clearTimeout(metadataTimer);
      metadataTimers.delete(sessionId);
    }

    const keysToDelete = new Set<string>();
    for (const key of context.saveDebouncers.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        const timer = context.saveDebouncers.get(key);
        if (timer) {
          clearTimeout(timer);
        }
        keysToDelete.add(key);
      }
    }
    for (const key of context.lastSaveTimestamps.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        keysToDelete.add(key);
      }
    }
    for (const key of context.lastSaveHashes.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        keysToDelete.add(key);
      }
    }
    for (const key of context.turnSavePending.values()) {
      if (key.startsWith(`${sessionId}:`)) {
        keysToDelete.add(key);
      }
    }
    for (const key of context.turnSaveInFlight.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        keysToDelete.add(key);
      }
    }

    keysToDelete.forEach(key => {
      context.saveDebouncers.delete(key);
      context.lastSaveTimestamps.delete(key);
      context.lastSaveHashes.delete(key);
      context.turnSavePending.delete(key);
      context.turnSaveInFlight.delete(key);
    });
  }
}

/**
 * Save dialog turn to disk (FlowChat format → backend format)
 */
export async function saveDialogTurnToDisk(
  context: FlowChatContext,
  sessionId: string,
  turnId: string
): Promise<void> {
  await runSerialDialogTurnSave(context, sessionId, turnId);
}

async function performSaveDialogTurnToDisk(
  context: FlowChatContext,
  sessionId: string,
  turnId: string
): Promise<void> {
  try {
    const { sessionAPI } = await import('@/infrastructure/api');

    const session = context.flowChatStore.getState().sessions.get(sessionId);
    if (!session) {
      log.debug('Session not found, skipping save', { sessionId, turnId });
      return;
    }
    if (isTransientSession(session)) {
      return;
    }

    const workspacePath = requireWorkspacePath(sessionId, session.workspacePath, session.storageScope);
    
    const dialogTurn = session.dialogTurns.find(turn => turn.id === turnId);
    if (!dialogTurn) {
      log.debug('Dialog turn not found, skipping save', { sessionId, turnId });
      return;
    }

    const turnIndex = dialogTurn.backendTurnIndex ?? session.dialogTurns.indexOf(dialogTurn);
    const turnData = convertDialogTurnToBackendFormat(dialogTurn, turnIndex);
    await sessionAPI.saveSessionTurn(
      turnData,
      workspacePath,
      session.storageScope
    );
    
    scheduleSessionMetadataUpdate(context, sessionId);
    
  } catch (error) {
    log.error('Failed to save dialog turn', { sessionId, turnId, error });
  }
}

/**
 * Save all in-progress dialog turns
 * Used when closing the window to persist unfinished session turns
 */
export async function saveAllInProgressTurns(context: FlowChatContext): Promise<void> {
  const state = context.flowChatStore.getState();
  const savePromises: Promise<void>[] = [];
  
  for (const [sessionId, session] of state.sessions.entries()) {
    if (isTransientSession(session)) {
      continue;
    }
    const lastTurn = session.dialogTurns[session.dialogTurns.length - 1];
    
    if (lastTurn) {
      const key = `${sessionId}:${lastTurn.id}`;
      const timer = context.saveDebouncers.get(key);
      if (timer) {
        clearTimeout(timer);
        context.saveDebouncers.delete(key);
      }
      
      if (
        lastTurn.status !== 'completed' &&
        lastTurn.status !== 'cancelled' &&
        lastTurn.status !== 'error'
      ) {
        const settledAt = Date.now();
        context.flowChatStore.updateDialogTurn(sessionId, lastTurn.id, turn =>
          finalizeFlowTurn(turn, {
            reason: 'app_restart',
            settledAt,
            preserveWaitingConfirmation: true,
          })
        );
        
        savePromises.push(
          saveDialogTurnToDisk(context, sessionId, lastTurn.id).catch(error => {
            log.error('Failed to save in-progress turn', { sessionId, turnId: lastTurn.id, error });
          })
        );
      }
    }
  }
  
  await Promise.all(savePromises);
}

/**
 * Convert FlowChat DialogTurn to backend format
 */
export function convertDialogTurnToBackendFormat(dialogTurn: DialogTurn, turnIndex: number): any {
  const userMetadata = dialogTurn.userMessage.metadata
    ? { ...dialogTurn.userMessage.metadata }
    : undefined;
  const mergedUserMetadata =
    dialogTurn.userMessage.images?.length
      ? {
          ...(userMetadata || {}),
          images: dialogTurn.userMessage.images.map(img => ({
            id: img.id,
            name: img.name,
            data_url: img.dataUrl,
            image_path: img.imagePath,
            mime_type: img.mimeType,
          })),
          original_text: dialogTurn.userMessage.content,
        }
      : userMetadata;

  return {
    turnId: dialogTurn.id,
    turnIndex,
    sessionId: dialogTurn.sessionId,
    timestamp: dialogTurn.startTime,
    kind: dialogTurn.kind || 'user_dialog',
    userMessage: {
      id: dialogTurn.userMessage.id,
      content: dialogTurn.userMessage.content,
      timestamp: dialogTurn.userMessage.timestamp,
      metadata: mergedUserMetadata,
    },
    modelRounds: dialogTurn.modelRounds.map((round, roundIndex) => {
      return {
        id: round.id,
        turnId: dialogTurn.id,
        roundIndex,
        timestamp: round.startTime,
        textItems: round.items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.type === 'text')
          .map(({ item, index }) => {
            return {
              id: item.id,
              content: (item as any).content || '',
              isStreaming: (item as any).isStreaming || false,
              isMarkdown: (item as any).isMarkdown !== undefined ? (item as any).isMarkdown : true,
              timestamp: item.timestamp,
              status: item.status || 'completed',
              orderIndex: index,
            };
          }),
        toolItems: round.items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.type === 'tool')
          .map(({ item, index }) => {
            const toolItem = item as any;
            return {
              id: item.id,
              toolName: toolItem.toolName || '',
              interruptionReason: toolItem.interruptionReason,
              toolCall: toolItem.toolCall || { input: {}, id: item.id },
              toolResult: toolItem.toolResult,
              runtime: toolItem.runtime,
              aiIntent: toolItem.aiIntent,
              startTime: toolItem.startTime || item.timestamp,
              endTime: toolItem.endTime,
              status: item.status || 'completed',
              orderIndex: index,
              executionProjection: toolItem.executionProjection,
            };
          }),
        thinkingItems: round.items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.type === 'thinking')
          .map(({ item, index }) => {
            const thinkingItem = item as any;
            return {
              id: item.id,
              content: thinkingItem.content || '',
              isStreaming: thinkingItem.isStreaming || false,
              isCollapsed: thinkingItem.isCollapsed || false,
              timestamp: item.timestamp,
              status: item.status || 'completed',
              orderIndex: index,
            };
          }),
        startTime: round.startTime,
        endTime: round.endTime,
        status: round.status || 'completed',
      };
    }),
    startTime: dialogTurn.startTime,
    endTime: dialogTurn.endTime,
    status: dialogTurn.status === 'completed' ? 'completed' : 
            dialogTurn.status === 'error' ? 'error' : 
            dialogTurn.status === 'cancelled' ? 'cancelled' : 'inprogress',
  };
}

/**
 * Update session metadata (lastActiveAt, statistics, etc.)
 * Loads existing metadata first to avoid overwriting correct historical counts
 * when the in-memory dialogTurns only has a partial view (e.g. remote-triggered turns
 * on a persisted session whose full turn history hasn't been loaded yet).
 */
export async function updateSessionMetadata(
  context: FlowChatContext,
  sessionId: string
): Promise<void> {
  try {
    const { sessionAPI } = await import('@/infrastructure/api');

    const session = context.flowChatStore.getState().sessions.get(sessionId);
    if (!session) return;
    if (isTransientSession(session)) return;

    const workspacePath = requireWorkspacePath(sessionId, session.workspacePath, session.storageScope);

    let existingMetadata: any = null;
    try {
      existingMetadata = await sessionAPI.loadSessionMetadata(
        sessionId,
        workspacePath,
        session.storageScope
      );
    } catch {
      // ignore
    }

    const metadata = buildSessionMetadata(session, existingMetadata);

    await sessionAPI.saveSessionMetadata(
      metadata,
      workspacePath,
      session.storageScope
    );
  } catch (error) {
    log.warn('Failed to update session metadata', { sessionId, error });
  }
}

/**
 * Update session activity time (used for session switching)
 */
export async function touchSessionActivity(
  sessionId: string,
  workspacePath?: string,
  storageScope?: import('@/shared/types/session-history').SessionStorageScope
): Promise<void> {
  try {
    const { sessionAPI } = await import('@/infrastructure/api');
    await sessionAPI.touchSessionActivity(
      sessionId,
      requireWorkspacePath(sessionId, workspacePath, storageScope),
      storageScope
    );
  } catch (error) {
    log.debug('Failed to touch session activity', { sessionId, error });
  }
}
