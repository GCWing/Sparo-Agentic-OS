import { describe, expect, it } from 'vitest';
import {
  descriptorFromBackendSessionCreated,
  descriptorFromAgentType,
  getProductAppRuntimeSessionDescriptor,
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

  it('does not project unknown backend session events as Runno', () => {
    const descriptor = descriptorFromBackendSessionCreated('Reviewer');

    expect(descriptor).toBeNull();
  });

  it('keeps the Product App profile separate from its execution agent', () => {
    const descriptor = getProductAppRuntimeSessionDescriptor('Runno');

    expect(descriptor.hostKind).toBe('product-app-runtime');
    expect(descriptor.profileId).toBe('product-app-runtime');
    expect(descriptor.identityId).toBe('product-app-runtime');
    expect(descriptor.agentPolicy).toEqual({
      defaultAgentId: 'Runno',
      activeAgentId: 'Runno',
      switchableAgentIds: ['Runno'],
    });
  });

  it('does not downgrade an existing Product App descriptor from backend session events', () => {
    const existing = getProductAppRuntimeSessionDescriptor('Runno');
    const descriptor = descriptorFromBackendSessionCreated('Runno', existing);

    expect(descriptor.profileId).toBe('product-app-runtime');
    expect(descriptor.hostKind).toBe('product-app-runtime');
    expect(descriptor.agentPolicy.activeAgentId).toBe('Runno');
  });

  it('maps the hidden settings agent to its system settings profile', () => {
    const descriptor = descriptorFromAgentType('SettingsAgent');

    expect(descriptor.hostKind).toBe('system-settings');
    expect(descriptor.profileId).toBe('settings');
    expect(descriptor.identityId).toBe('settings');
    expect(descriptor.sessionDomainKind).toBe('global');
    expect(descriptor.agentPolicy).toEqual({
      defaultAgentId: 'SettingsAgent',
      activeAgentId: 'SettingsAgent',
      switchableAgentIds: ['SettingsAgent'],
    });
  });
});
