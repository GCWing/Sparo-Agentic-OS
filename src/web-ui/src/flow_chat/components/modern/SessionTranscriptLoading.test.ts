import { describe, expect, it } from 'vitest';
import {
  shouldShowSessionTranscriptError,
  shouldShowSessionTranscriptLoading,
} from './SessionTranscriptLoading';

describe('session transcript loading state', () => {
  it('shows while the requested session metadata or transcript is loading', () => {
    expect(shouldShowSessionTranscriptLoading('session-1', null)).toBe(true);
    expect(shouldShowSessionTranscriptLoading('session-1', { sessionId: 'session-1', loadPhase: 'metadata-only' })).toBe(true);
    expect(shouldShowSessionTranscriptLoading('session-1', { sessionId: 'session-1', loadPhase: 'hydrating' })).toBe(true);
  });

  it('stops for ready or failed sessions and for the welcome surface', () => {
    expect(shouldShowSessionTranscriptLoading('session-1', { sessionId: 'session-1', loadPhase: 'hydrated' })).toBe(false);
    expect(shouldShowSessionTranscriptLoading('session-1', { sessionId: 'session-1', loadPhase: 'live' })).toBe(false);
    expect(shouldShowSessionTranscriptLoading('session-1', { sessionId: 'session-1', loadPhase: 'hydrate-failed' })).toBe(false);
    expect(shouldShowSessionTranscriptLoading(null, null)).toBe(false);
  });

  it('keeps the target masked while the active metadata belongs to another session', () => {
    expect(shouldShowSessionTranscriptLoading('session-2', {
      sessionId: 'session-1',
      loadPhase: 'hydrated',
    })).toBe(true);
  });

  it('shows a persistent error only for the requested failed session', () => {
    expect(shouldShowSessionTranscriptError('session-1', {
      sessionId: 'session-1',
      loadPhase: 'hydrate-failed',
    })).toBe(true);
    expect(shouldShowSessionTranscriptError('session-2', {
      sessionId: 'session-1',
      loadPhase: 'hydrate-failed',
    })).toBe(false);
  });
});
