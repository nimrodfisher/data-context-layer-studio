import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { isSecretKey, isSecretValue } from '@context-layer/core';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';

import {
  assertSafeLocator,
  diagnostic,
  errorCode,
  evidenceRecord,
  result,
  validateAdapterRequest,
  withDeadline,
} from './common.js';
import type { AdapterOptions, SourceAdapter } from './types.js';

export const RestInputSchema = z.strictObject({
  url: z.url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type RestInput = z.infer<typeof RestInputSchema>;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type HostnameResolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly ResolvedAddress[]>;

export interface RestTransportRequest {
  url: URL;
  addresses: readonly ResolvedAddress[];
  method: 'GET';
  headers: Headers;
  redirect: 'manual';
  signal: AbortSignal;
}

export interface RestRequestTransport {
  request(input: RestTransportRequest): Promise<Response>;
}

export interface RestEndpointPolicy {
  allowedPrivateHosts?: string[];
}

export type CredentialResolver = (
  credentialRef: string,
  signal: AbortSignal,
) => Promise<Record<string, string> | undefined>;

export interface RestApiAdapterOptions extends AdapterOptions {
  hostnameResolver?: HostnameResolver;
  transport: RestRequestTransport;
  credentialResolver?: CredentialResolver;
  endpointPolicy?: RestEndpointPolicy;
  allowedInlineHeaders?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  allowedContentTypes?: string[];
}

const nodeHostnameResolver: HostnameResolver = async (hostname, signal) => {
  if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
  const family = isIP(hostname);
  if (family === 4 || family === 6) return [{ address: hostname, family }];
  const entries = await lookup(hostname, { all: true, verbatim: true });
  if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
  return entries.map(({ address, family: resolvedFamily }) => ({
    address,
    family: resolvedFamily as 4 | 6,
  }));
};

function isValidAddress({ address, family }: ResolvedAddress): boolean {
  if (isIP(address) !== family) return false;
  const parsed = ipaddr.parse(address);
  return (family === 4 && parsed.kind() === 'ipv4') || (family === 6 && parsed.kind() === 'ipv6');
}

function isReservedAddress({ address }: ResolvedAddress): boolean {
  const parsed = ipaddr.parse(address);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    return parsed.toIPv4Address().range() !== 'unicast';
  }
  return parsed.range() !== 'unicast';
}

function validateUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function safeHeaders(
  headers: Record<string, string> | undefined,
  allowedNames: ReadonlySet<string>,
  credentials: boolean,
): Headers {
  const output = new Headers();
  const transportForbidden = new Set(['connection', 'content-length', 'host', 'transfer-encoding']);
  const explicitSecrets = new Set(['cookie', 'proxy-authorization', 'x-api-key', 'x-auth-token']);
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase();
    if (
      transportForbidden.has(normalized) ||
      /[\r\n]/.test(name) ||
      /[\r\n]/.test(value) ||
      (!credentials &&
        (!allowedNames.has(normalized) ||
          explicitSecrets.has(normalized) ||
          isSecretKey(name) ||
          isSecretValue(value)))
    ) {
      throw Object.assign(new Error('forbidden header'), { code: 'HEADER_FORBIDDEN' });
    }
    output.set(name, value);
  }
  return output;
}

function contentTypeAllowed(contentType: string, allowed: readonly string[]): boolean {
  const mediaType = contentType.split(';', 1)[0]!.trim().toLowerCase();
  return allowed.some((entry) =>
    entry.endsWith('/*') ? mediaType.startsWith(entry.slice(0, -1)) : mediaType === entry,
  );
}

async function streamedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw Object.assign(new Error('large response'), { code: 'RESPONSE_TOO_LARGE' });
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => {
    void reader.cancel();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error('large response'), { code: 'RESPONSE_TOO_LARGE' });
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function createRestApiAdapter(options: RestApiAdapterOptions): SourceAdapter<RestInput> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const now = options.now ?? (() => new Date());
  const resolveHostname = options.hostnameResolver ?? nodeHostnameResolver;
  const allowedPrivateHosts = new Set(
    (options.endpointPolicy?.allowedPrivateHosts ?? []).map((entry) => entry.toLowerCase()),
  );
  const allowedInlineHeaders = new Set(
    (options.allowedInlineHeaders ?? ['accept', 'user-agent']).map((entry) => entry.toLowerCase()),
  );
  const allowedContentTypes = options.allowedContentTypes ?? [
    'text/*',
    'application/json',
    'application/yaml',
    'application/x-yaml',
    'application/xml',
  ];
  const specification = {
    adapterId: 'api',
    transports: ['api'] as const,
    connectionKinds: ['api', 'rest'] as const,
    inputSchema: RestInputSchema,
  };

  return {
    id: 'api',
    transports: specification.transports,
    connectionKinds: specification.connectionKinds,
    inputSchema: RestInputSchema,
    async collect(request) {
      const validation = validateAdapterRequest(request, specification);
      if (!validation.success) return validation.result;
      const { source, input } = validation;
      const rawUrl = input.url ?? source.connection.endpoint;
      if (rawUrl === undefined) {
        return result([], [diagnostic('REST_INVALID_URL', 'REST source has no endpoint')]);
      }
      const url = validateUrl(rawUrl);
      if (url === undefined) {
        const protocol = (() => {
          try {
            return new URL(rawUrl);
          } catch {
            return undefined;
          }
        })();
        const code =
          protocol !== undefined && !['http:', 'https:'].includes(protocol.protocol)
            ? 'REST_UNSUPPORTED_PROTOCOL'
            : protocol?.username || protocol?.password
              ? 'REST_URL_CREDENTIALS'
              : 'REST_INVALID_URL';
        return result([], [diagnostic(code, 'REST endpoint was rejected by policy')]);
      }
      try {
        assertSafeLocator(url.toString());
      } catch {
        return result(
          [],
          [
            diagnostic(
              'REST_QUERY_CREDENTIAL_FORBIDDEN',
              'REST endpoint contains forbidden credential-like query data',
            ),
          ],
        );
      }

      try {
        return await withDeadline(timeoutMs, async (signal) => {
          let credentialHeaders: Record<string, string> | undefined;
          if (source.connection.credentialRef !== undefined) {
            if (options.credentialResolver === undefined) {
              throw Object.assign(new Error('unresolved credential'), {
                code: 'CREDENTIAL_UNRESOLVED',
              });
            }
            credentialHeaders = await options.credentialResolver(
              source.connection.credentialRef,
              signal,
            );
            if (credentialHeaders === undefined) {
              throw Object.assign(new Error('unresolved credential'), {
                code: 'CREDENTIAL_UNRESOLVED',
              });
            }
          }
          const inlineHeaders = safeHeaders(input.headers, allowedInlineHeaders, false);
          const resolvedHeaders = safeHeaders(credentialHeaders, new Set(), true);
          for (const [name, value] of resolvedHeaders) inlineHeaders.set(name, value);

          const addresses = await resolveHostname(url.hostname.replace(/^\[|\]$/g, ''), signal);
          if (addresses.length === 0) {
            throw Object.assign(new Error('unavailable'), { code: 'DNS_UNAVAILABLE' });
          }
          if (addresses.some((address) => !isValidAddress(address))) {
            throw Object.assign(new Error('invalid DNS response'), {
              code: 'DNS_INVALID_RESPONSE',
            });
          }
          if (
            !allowedPrivateHosts.has(url.hostname.toLowerCase()) &&
            addresses.some(isReservedAddress)
          ) {
            throw Object.assign(new Error('private endpoint'), { code: 'PRIVATE_ENDPOINT' });
          }
          const pinnedAddresses = Object.freeze(
            addresses.map((address) => Object.freeze({ ...address })),
          );
          const response = await options.transport.request({
            url,
            addresses: pinnedAddresses,
            method: 'GET',
            headers: inlineHeaders,
            redirect: 'manual',
            signal,
          });
          if (response.status >= 300 && response.status < 400) {
            return result(
              [],
              [
                diagnostic(
                  'REST_REDIRECT',
                  'REST endpoint returned a redirect; the target was not followed or validated',
                  'error',
                  { details: { status: response.status } },
                ),
              ],
            );
          }
          if (!response.ok) {
            const code =
              response.status === 401 || response.status === 403
                ? 'REST_UNAUTHORIZED'
                : response.status === 429
                  ? 'REST_RATE_LIMITED'
                  : 'REST_HTTP_ERROR';
            return result(
              [],
              [
                diagnostic(code, 'REST endpoint returned an unsuccessful status', 'error', {
                  details: { status: response.status },
                }),
              ],
            );
          }
          const contentType = response.headers.get('content-type') ?? '';
          if (!contentTypeAllowed(contentType, allowedContentTypes)) {
            return result(
              [],
              [diagnostic('REST_CONTENT_TYPE', 'REST response content type is not allowed')],
            );
          }
          const content = await streamedBody(response, maxBytes, signal);
          return result(
            [
              evidenceRecord({
                adapterId: 'api',
                source,
                locator: url.toString(),
                retrievedAt: now().toISOString(),
                content,
                confidence: input.confidence,
                metadata: {
                  contentType,
                  status: response.status,
                  resolvedAddresses: pinnedAddresses,
                },
              }),
            ],
            [],
          );
        });
      } catch (error) {
        const code = (() => {
          switch (errorCode(error)) {
            case 'TIMEOUT':
              return 'REST_TIMEOUT';
            case 'HEADER_FORBIDDEN':
              return 'REST_HEADER_FORBIDDEN';
            case 'CREDENTIAL_UNRESOLVED':
              return 'REST_CREDENTIAL_UNRESOLVED';
            case 'PRIVATE_ENDPOINT':
              return 'REST_PRIVATE_ENDPOINT';
            case 'RESPONSE_TOO_LARGE':
              return 'REST_RESPONSE_TOO_LARGE';
            case 'DNS_UNAVAILABLE':
            case 'DNS_INVALID_RESPONSE':
              return 'REST_UNAVAILABLE';
            default:
              return error instanceof TypeError ? 'REST_INVALID_RESPONSE' : 'REST_UNAVAILABLE';
          }
        })();
        return result([], [diagnostic(code, 'REST collection failed')]);
      }
    },
  };
}
