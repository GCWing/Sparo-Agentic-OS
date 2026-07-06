import { describe, expect, it } from 'vitest';
import {
  descriptorFromAgentType,
  normalizeSessionDescriptor,
  SESSION_DESCRIPTORS,
  type SessionDescriptor,
} from './sessionDescriptor';

const BITFUN_CODER_AGENT_IDS = ['bitfun-coder', 'bitfun-plan', 'bitfun-debug', 'bitfun-team'];

describe('sessionDescriptor', () => {
  it('treats Runno as the default native execution agent', () => {
    const descriptor = descriptorFromAgentType('Runno');

    expect(descriptor.profileId).toBe('runno');
    expect(descriptor.identityId).toBe('runno');
    expect(descriptor.agentPolicy.defaultAgentId).toBe('Runno');
    expect(descriptor.agentPolicy.activeAgentId).toBe('Runno');
    expect(descriptor.agentPolicy.switchableAgentIds).toEqual(['Runno']);
  });

  it('treats BitFun Coder as an independent profile with full switch policy', () => {
    const descriptor = descriptorFromAgentType('bitfun-coder');

    expect(descriptor.profileId).toBe('bitfun-coder');
    expect(descriptor.identityId).toBe('bitfun-coder');
    expect(descriptor.agentPolicy.defaultAgentId).toBe('bitfun-coder');
    expect(descriptor.agentPolicy.activeAgentId).toBe('bitfun-coder');
    expect(descriptor.agentPolicy.switchableAgentIds).toEqual(BITFUN_CODER_AGENT_IDS);
  });

  it('normalizes stale BitFun Coder switchable lists without legacy agent ids', () => {
    const staleDescriptor: SessionDescriptor = {
      ...SESSION_DESCRIPTORS.bitfunCoder,
      agentPolicy: {
        defaultAgentId: 'bitfun-coder',
        activeAgentId: 'bitfun-plan',
        switchableAgentIds: ['bitfun-coder', 'bitfun-plan'],
      },
    };

    const descriptor = normalizeSessionDescriptor(staleDescriptor);

    expect(descriptor.agentPolicy.switchableAgentIds).toEqual(BITFUN_CODER_AGENT_IDS);
    expect(descriptor.agentPolicy.activeAgentId).toBe('bitfun-plan');
  });

  it('falls unknown agent type requests back to Runno', () => {
    const descriptor = descriptorFromAgentType('Reviewer');

    expect(descriptor.profileId).toBe('runno');
    expect(descriptor.agentPolicy.defaultAgentId).toBe('Runno');
    expect(descriptor.agentPolicy.activeAgentId).toBe('Runno');
    expect(descriptor.agentPolicy.switchableAgentIds).toEqual(['Runno']);
  });
});
