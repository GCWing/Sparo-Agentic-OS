import { describe, expect, it } from 'vitest';
import { canTrackUnreadCompletion } from './unreadCompletion';

describe('canTrackUnreadCompletion', () => {
  it('excludes transient and internal sessions from global unread state', () => {
    expect(canTrackUnreadCompletion({ isTransient: true, sessionKind: 'normal' })).toBe(false);
    expect(canTrackUnreadCompletion({ isTransient: false, sessionKind: 'internal' })).toBe(false);
  });

  it('keeps ordinary sessions eligible for unread completion', () => {
    expect(canTrackUnreadCompletion({ isTransient: false, sessionKind: 'normal' })).toBe(true);
  });
});
