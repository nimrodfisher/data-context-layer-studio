import { redactSecretText } from '@context-layer/core';
import type { ModelGenerator, ModelResponse } from '@context-layer/agent';
import { isIP } from 'node:net';

import { credentialReferenceIssue } from './security';

export interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

export function providerConfig(
  environment: Record<string, string | undefined> = process.env,
): ProviderConfig | undefined {
  const endpoint = environment.CONTEXT_LAYER_AI_BASE_URL;
  const model = environment.CONTEXT_LAYER_AI_MODEL;
  const keyRef = environment.CONTEXT_LAYER_AI_API_KEY_REF;
  const allowedHosts = new Set(
    (environment.CONTEXT_LAYER_AI_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLocaleLowerCase('en-US'))
      .filter(Boolean),
  );
  const apiKey = keyRef ? environment[keyRef] : undefined;
  if (!endpoint || !model || !keyRef || !apiKey || allowedHosts.size === 0) return undefined;
  const referenceIssue = credentialReferenceIssue(keyRef);
  if (referenceIssue) throw new Error(`AI credential reference is invalid. ${referenceIssue}`);
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('AI endpoint must not contain credentials, query parameters, or fragments.');
  }
  const hostname = url.hostname.toLocaleLowerCase('en-US');
  if (!allowedHosts.has(hostname)) throw new Error('AI endpoint host is not allowlisted.');
  const privateHost =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) ||
    (isIP(hostname) === 6 && /^(?:fc|fd|fe80)/i.test(hostname));
  const privateAllowed = environment.CONTEXT_LAYER_AI_ALLOW_PRIVATE === 'true';
  if (privateHost && !privateAllowed) {
    throw new Error('AI endpoint is private and requires explicit private-network opt-in.');
  }
  if (url.protocol !== 'https:' && !(privateHost && privateAllowed && url.protocol === 'http:')) {
    throw new Error('AI endpoint must use HTTPS.');
  }
  return { endpoint: url.toString().replace(/\/$/, ''), model, apiKey };
}

export function openAICompatibleGenerator(config: ProviderConfig): ModelGenerator {
  return {
    async generate(request): Promise<ModelResponse> {
      const response = await fetch(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          max_tokens: Math.min(2_000, Math.ceil(request.maxOutputChars / 2)),
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Return only JSON matching the requested schema. Every factual claim must cite selected evidence with an exact supporting quote. Never invent evidence.',
            },
            {
              role: 'user',
              content: redactSecretText(request.prompt).slice(0, 12_000),
            },
          ],
        }),
        signal: request.signal,
      });
      if (!response.ok) {
        throw new Error('The configured AI provider rejected the drafting request.');
      }
      const body = (await response.json()) as {
        id?: string;
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('The configured AI provider returned no draft.');
      }
      let output: unknown;
      try {
        output = JSON.parse(redactSecretText(content));
      } catch {
        throw new Error('The configured AI provider returned invalid JSON.');
      }
      return {
        output,
        metadata: {
          provider: 'openai-compatible',
          model: config.model,
          ...(typeof body.id === 'string' ? { requestId: body.id } : {}),
        },
      };
    },
  };
}
