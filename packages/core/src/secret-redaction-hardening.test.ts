import { describe, expect, it } from 'vitest';

import { isSecretValue, redactSecretText, redactSecrets } from './secret-keys.js';

describe('central secret redaction hardening', () => {
  it.each([
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue',
    'AKIAIOSFODNN7EXAMPLE',
    'AIzaSyD-example-key-with-enough-length',
    'ghp_TESTONLY_fake_github_pat_not_a_real_secret',
    'xoxb-TESTONLY-fake-slack-token-not-a-real-secret',
    '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----',
    'password="quoted secret value"',
    "token='multi\nline secret'",
    'AccountKey=abcdefghijklmnopqrstuvwxyz0123456789==',
    'aws_secret_access_key = "abcdefghijklmnopqrstuvwxyz0123456789"',
  ])('detects and redacts %j', (secret) => {
    expect(isSecretValue(secret)).toBe(true);
    expect(redactSecretText(`prefix ${secret} suffix`)).not.toContain(secret);
    expect(JSON.stringify(redactSecrets({ nested: `prefix ${secret} suffix` }))).not.toContain(
      secret,
    );
  });

  it('redacts embedded credentials without damaging credential references', () => {
    expect(
      redactSecrets({
        message: 'authorization: Bearer abc.def.ghi',
        credentialRef: 'vault://safe/model',
      }),
    ).toEqual({
      message: '[REDACTED]',
      credentialRef: 'vault://safe/model',
    });
  });
});
