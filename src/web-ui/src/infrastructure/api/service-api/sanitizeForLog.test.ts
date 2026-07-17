import { describe, expect, it } from 'vitest';
import { sanitizeForLog } from './sanitizeForLog';

describe('sanitizeForLog', () => {
  it('masks every leaf in credential containers regardless of child key', () => {
    const sanitized = sanitizeForLog({
      mcpServers: {
        private: {
          env: {
            FOO: 'plain-env-secret'
          },
          headers: {
            Cookie: 'plain-cookie-secret',
            Authorization: 'Bearer plain-authorized-secret'
          }
        }
      },
      model: {
        custom_headers: {
          'X-Custom': 'plain-custom-secret'
        },
        extraHeaders: {
          'X-Equivalent': 'plain-equivalent-secret'
        }
      },
      ordinary: {
        labels: {
          FOO: 'visible-ordinary-value'
        }
      },
      apiKey: 'direct-secret-value',
      privateKey: 'private-key-value',
      request: {
        prompt: 'Set my API key to short-value',
        error: 'failed with credential-value'
      }
    });

    expect(sanitized).toEqual({
      mcpServers: {
        private: {
          env: {
            FOO: '***'
          },
          headers: {
            Cookie: '***',
            Authorization: '***'
          }
        }
      },
      model: {
        custom_headers: {
          'X-Custom': '***'
        },
        extraHeaders: {
          'X-Equivalent': '***'
        }
      },
      ordinary: {
        labels: {
          FOO: 'visible-ordinary-value'
        }
      },
      apiKey: '***',
      privateKey: '***',
      request: {
        prompt: '***',
        error: '***'
      }
    });

    const serialized = JSON.stringify(sanitized);
    for (const secret of [
      'plain-env-secret',
      'plain-cookie-secret',
      'plain-authorized-secret',
      'plain-custom-secret',
      'plain-equivalent-secret',
      'direct-secret-value',
      'private-key-value',
      'short-value',
      'credential-value'
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
