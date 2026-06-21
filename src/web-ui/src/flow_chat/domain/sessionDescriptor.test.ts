import { describe, expect, it } from 'vitest';
import {
  descriptorFromAgentType,
  normalizeSessionDescriptor,
  SESSION_DESCRIPTORS,
  type SessionDescriptor,
} from './sessionDescriptor';

const CODE_AGENT_IDS = ['agentic', 'Plan', 'debug', 'Team'];

describe('sessionDescriptor', () => {
  it('treats agentic as the Prime Builder default agent with full switch policy', () => {
    const descriptor = descriptorFromAgentType('agentic');

    expect(descriptor.profileId).toBe('coding');
    expect(descriptor.identityId).toBe('code');
    expect(descriptor.agentPolicy.defaultAgentId).toBe('agentic');
    expect(descriptor.agentPolicy.activeAgentId).toBe('agentic');
    expect(descriptor.agentPolicy.switchableAgentIds).toEqual(CODE_AGENT_IDS);
  });

  it('normalizes legacy single-agent Prime Builder descriptors', () => {
    const legacyDescriptor: SessionDescriptor = {
      ...SESSION_DESCRIPTORS.coding,
      agentPolicy: {
        defaultAgentId: 'agentic',
        activeAgentId: 'agentic',
        switchableAgentIds: ['agentic'],
      },
    };

    const descriptor = normalizeSessionDescriptor(legacyDescriptor);

    expect(descriptor.agentPolicy.switchableAgentIds).toEqual(CODE_AGENT_IDS);
    expect(descriptor.agentPolicy.activeAgentId).toBe('agentic');
  });

  it('keeps custom single-agent descriptors scoped to their own agent', () => {
    const descriptor = descriptorFromAgentType('Reviewer');

    expect(descriptor.profileId).toBe('coding');
    expect(descriptor.agentPolicy.defaultAgentId).toBe('Reviewer');
    expect(descriptor.agentPolicy.activeAgentId).toBe('Reviewer');
    expect(descriptor.agentPolicy.switchableAgentIds).toEqual(['Reviewer']);
  });
});
