const PLAYER_BASELINE_REVISION = -1;

const PLAYER_CONNECTION_LIFECYCLE_TYPES = new Set([
  'channelReady',
  'ready',
  'error',
]);

const PLAYER_REVISION_ORDERED_STATE_TYPES = new Set([
  'snapshot',
  'frameCommitted',
  'actualState',
  'seekSettled',
  'playing',
  'paused',
  'buffering',
  'ended',
]);

const PLAYER_RUNTIME_EVIDENCE_TYPES = new Set([
  'ready',
  'commandFailed',
  'snapshot',
  'frameContext',
  'frameCommitted',
  'actualState',
  'seekSettled',
  'playing',
  'paused',
  'buffering',
  'ended',
]);

function playerMessageRevision(message = {}) {
  const revision = Number(message.revision);
  return Number.isFinite(revision) ? revision : null;
}

function isStalePlayerStateMessage(message = {}, currentRevision = PLAYER_BASELINE_REVISION) {
  if (!PLAYER_REVISION_ORDERED_STATE_TYPES.has(message.type)) return false;
  const revision = playerMessageRevision(message);
  return revision !== null && revision < Number(currentRevision);
}

function isPlayerConnectionLifecycleMessage(message = {}) {
  return PLAYER_CONNECTION_LIFECYCLE_TYPES.has(message.type);
}

function isPlayerRuntimeEvidenceMessage(message = {}) {
  return PLAYER_RUNTIME_EVIDENCE_TYPES.has(message.type);
}

export {
  PLAYER_BASELINE_REVISION,
  isPlayerConnectionLifecycleMessage,
  isPlayerRuntimeEvidenceMessage,
  isStalePlayerStateMessage,
  playerMessageRevision,
};
