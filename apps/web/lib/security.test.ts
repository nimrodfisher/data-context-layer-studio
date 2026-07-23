import { describe, expect, it } from 'vitest';

import { providerConfig } from './provider';
import { credentialReferenceIssue } from './security';

describe('credential references', () => {
  it.each(['DBT_TOKEN', 'CONTEXT_LAYER_API_KEY_2', '_LOCAL_SECRET'])(
    'accepts environment variable name %s',
    (value) => {
      expect(credentialReferenceIssue(value)).toBeUndefined();
    },
  );

  it.each(['vault://dbt/token', 'abc-def', 'sk-this-is-a-secret-value', 'token=literal'])(
    'rejects unsafe credential reference %s',
    (value) => {
      expect(credentialReferenceIssue(value)).toBeTruthy();
    },
  );
});

describe('AI provider configuration', () => {
  const base = {
    CONTEXT_LAYER_AI_MODEL: 'draft-model',
    CONTEXT_LAYER_AI_API_KEY_REF: 'MODEL_KEY',
    MODEL_KEY: 'test-key-value',
    CONTEXT_LAYER_AI_ALLOWED_HOSTS: 'models.example.com',
  };

  it('accepts a credential-free allowlisted HTTPS endpoint', () => {
    const config = providerConfig({
      ...base,
      CONTEXT_LAYER_AI_BASE_URL: 'https://models.example.com/v1',
    });

    expect(config?.endpoint).toBe('https://models.example.com/v1');
  });

  it.each([
    'https://user:pass@models.example.com/v1',
    'https://models.example.com/v1?token=value',
    'https://models.example.com/v1#internal',
    'https://other.example.com/v1',
  ])('rejects endpoint %s', (endpoint) => {
    expect(() => providerConfig({ ...base, CONTEXT_LAYER_AI_BASE_URL: endpoint })).toThrow();
  });

  it('requires explicit opt-in for a private endpoint', () => {
    expect(() =>
      providerConfig({
        ...base,
        CONTEXT_LAYER_AI_ALLOWED_HOSTS: '127.0.0.1',
        CONTEXT_LAYER_AI_BASE_URL: 'http://127.0.0.1:11434/v1',
      }),
    ).toThrow(/private/i);
  });
});
