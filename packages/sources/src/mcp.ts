import { redactSecrets } from '@context-layer/core';
import { z } from 'zod';

import {
  assertSafeLocator,
  byteLength,
  canonicalize,
  diagnostic,
  errorCode,
  evidenceRecord,
  result,
  stableStringify,
  validateAdapterRequest,
  withDeadline,
} from './common.js';
import type {
  AdapterOptions,
  CollectionDiagnostic,
  EvidenceRecord,
  SourceAdapter,
} from './types.js';

const ResourceOperationSchema = z.strictObject({
  operationId: z.string().min(1),
  kind: z.literal('resource'),
  uri: z.string().min(1),
});
const ToolOperationSchema = z.strictObject({
  operationId: z.string().min(1),
  kind: z.literal('tool'),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const McpOperationSchema = z.discriminatedUnion('kind', [
  ResourceOperationSchema,
  ToolOperationSchema,
]);
export const McpAllowedOperationSchema = z.discriminatedUnion('kind', [
  ResourceOperationSchema,
  ToolOperationSchema,
]);
export const McpInputSchema = z.strictObject({
  operations: z.array(McpOperationSchema),
});

export type McpOperation = z.infer<typeof McpOperationSchema>;
export type McpAllowedOperation = z.infer<typeof McpAllowedOperationSchema>;
export type McpInput = z.infer<typeof McpInputSchema>;

export interface McpClient {
  readResource(input: { uri: string; signal: AbortSignal }): Promise<unknown>;
  callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface McpAdapterOptions extends AdapterOptions {
  client: McpClient;
  allowedOperations: readonly McpAllowedOperation[];
  timeoutMs?: number;
  maxBytes?: number;
}

const ResourceContentsSchema = z
  .object({
    uri: z.string().min(1),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
  })
  .passthrough()
  .refine(({ text, blob }) => (text === undefined) !== (blob === undefined));
const ResourceResponseSchema = z
  .object({
    contents: z.array(ResourceContentsSchema).min(1),
  })
  .passthrough();
const TextBlockSchema = z.object({ type: z.literal('text'), text: z.string() }).passthrough();
const EmbeddedResourceBlockSchema = z
  .object({
    type: z.literal('resource'),
    resource: ResourceContentsSchema,
  })
  .passthrough();
const LinkBlockSchema = z
  .object({
    type: z.enum(['resource_link', 'resource-link']),
    uri: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .passthrough();
const BlobBlockSchema = z
  .object({
    type: z.enum(['image', 'audio', 'blob']),
    data: z.string().optional(),
    blob: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .passthrough();
const ToolResponseSchema = z
  .object({
    content: z
      .array(
        z.union([TextBlockSchema, EmbeddedResourceBlockSchema, LinkBlockSchema, BlobBlockSchema]),
      )
      .optional(),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
  })
  .passthrough()
  .refine(
    ({ content, structuredContent }) => content !== undefined || structuredContent !== undefined,
  );

function containsCredentialValue(value: unknown): boolean {
  return JSON.stringify(redactSecrets(value)) !== JSON.stringify(value);
}

function descriptorKey(operation: McpAllowedOperation): string {
  return stableStringify(operation);
}

function failureCode(error: unknown): string {
  switch (errorCode(error).toUpperCase()) {
    case 'TIMEOUT':
      return 'MCP_TIMEOUT';
    case 'UNAUTHORIZED':
    case 'FORBIDDEN':
      return 'MCP_UNAUTHORIZED';
    case 'RATE_LIMITED':
    case 'TOO_MANY_REQUESTS':
      return 'MCP_RATE_LIMITED';
    default:
      return 'MCP_UNAVAILABLE';
  }
}

function duplicateIds(operations: readonly McpOperation[]): boolean {
  const ids = operations.map(({ operationId }) => operationId);
  return new Set(ids).size !== ids.length;
}

function validateRequestIds(input: McpInput): CollectionDiagnostic | undefined {
  if (duplicateIds(input.operations)) {
    return diagnostic(
      'MCP_DUPLICATE_OPERATION_ID',
      'MCP operation IDs must be unique within each collection',
    );
  }
  return undefined;
}

function normalizeResourceResponse(response: unknown): {
  content?: string;
  diagnostics: CollectionDiagnostic[];
} {
  const parsed = ResourceResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      diagnostics: [diagnostic('MCP_INVALID_RESPONSE', 'MCP resource response is invalid')],
    };
  }
  const diagnostics: CollectionDiagnostic[] = [];
  const parts: string[] = [];
  for (const item of parsed.data.contents) {
    try {
      assertSafeLocator(item.uri);
    } catch {
      diagnostics.push(
        diagnostic('MCP_LOCATOR_FORBIDDEN', 'MCP response contained a forbidden resource URI'),
      );
      continue;
    }
    if (item.blob !== undefined) {
      diagnostics.push(
        diagnostic('MCP_UNSUPPORTED_BLOB', 'MCP binary resource content is unsupported'),
      );
    } else {
      parts.push(`${item.uri}\n${item.text}`);
    }
  }
  return { content: parts.length > 0 ? parts.join('\n\n') : undefined, diagnostics };
}

function normalizeToolResponse(response: unknown): {
  content?: string;
  diagnostics: CollectionDiagnostic[];
  isError: boolean;
} {
  const parsed = ToolResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      diagnostics: [diagnostic('MCP_INVALID_RESPONSE', 'MCP tool response is invalid')],
      isError: false,
    };
  }
  const diagnostics: CollectionDiagnostic[] = [];
  if (parsed.data.isError) {
    diagnostics.push(diagnostic('MCP_TOOL_ERROR', 'MCP tool reported an operation error'));
  }
  const parts: string[] = [];
  for (const block of parsed.data.content ?? []) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'resource') {
      try {
        assertSafeLocator(block.resource.uri);
      } catch {
        diagnostics.push(
          diagnostic(
            'MCP_LOCATOR_FORBIDDEN',
            'MCP response contained a forbidden embedded resource URI',
          ),
        );
        continue;
      }
      if (block.resource.blob !== undefined) {
        diagnostics.push(
          diagnostic('MCP_UNSUPPORTED_BLOB', 'MCP embedded binary resource is unsupported'),
        );
      } else {
        parts.push(`${block.resource.uri}\n${block.resource.text}`);
      }
    } else if (block.type === 'resource_link' || block.type === 'resource-link') {
      try {
        assertSafeLocator(block.uri);
        parts.push(`${block.name ?? 'resource'}: ${block.uri}`);
      } catch {
        diagnostics.push(
          diagnostic('MCP_LOCATOR_FORBIDDEN', 'MCP response contained a forbidden resource link'),
        );
      }
    } else {
      diagnostics.push(diagnostic('MCP_UNSUPPORTED_BLOB', 'MCP binary content is unsupported'));
    }
  }
  if (parsed.data.structuredContent !== undefined) {
    parts.push(stableStringify(redactSecrets(parsed.data.structuredContent)));
  }
  if (parts.length === 0 && diagnostics.length === 0) {
    diagnostics.push(diagnostic('MCP_INVALID_RESPONSE', 'MCP tool response contained no content'));
  }
  return {
    content: parts.length > 0 ? parts.join('\n\n') : undefined,
    diagnostics,
    isError: parsed.data.isError === true,
  };
}

export function createMcpAdapter(options: McpAdapterOptions): SourceAdapter<McpInput> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const now = options.now ?? (() => new Date());
  const parsedAllowed = z.array(McpAllowedOperationSchema).parse(options.allowedOperations);
  if (duplicateIds(parsedAllowed)) throw new Error('MCP allowed operation IDs must be unique');
  for (const operation of parsedAllowed) {
    try {
      assertSafeLocator(operation.operationId);
      assertSafeLocator(
        operation.kind === 'resource' ? operation.uri : `mcp-tool:${operation.tool}`,
      );
    } catch {
      throw new Error('MCP allowed operations must not contain credential values');
    }
    if (
      operation.kind === 'tool' &&
      operation.arguments !== undefined &&
      containsCredentialValue(operation.arguments)
    ) {
      throw new Error('MCP allowed operations must not contain credential values');
    }
  }
  const trustedAllowed = Object.freeze(
    parsedAllowed.map((operation) => Object.freeze(canonicalize(operation))),
  ) as readonly McpAllowedOperation[];
  const allowed = new Map(
    trustedAllowed.map((operation) => [operation.operationId, descriptorKey(operation)]),
  );
  const specification = {
    adapterId: 'mcp',
    transports: ['mcp'] as const,
    connectionKinds: ['mcp'] as const,
    inputSchema: McpInputSchema,
  };

  return {
    id: 'mcp',
    transports: specification.transports,
    connectionKinds: specification.connectionKinds,
    inputSchema: McpInputSchema,
    async collect(request) {
      const validation = validateAdapterRequest(request, specification);
      if (!validation.success) return validation.result;
      const { source, input } = validation;
      const duplicate = validateRequestIds(input);
      if (duplicate !== undefined) return result([], [duplicate]);
      const retrievedAt = now().toISOString();
      try {
        return await withDeadline(timeoutMs, async (signal) => {
          const records: EvidenceRecord[] = [];
          const diagnostics: CollectionDiagnostic[] = [];
          for (const operation of input.operations) {
            if (allowed.get(operation.operationId) !== descriptorKey(operation)) {
              diagnostics.push(
                diagnostic(
                  'MCP_OPERATION_NOT_ALLOWED',
                  'MCP operation descriptor was not explicitly allowed',
                  'error',
                  { operationId: operation.operationId },
                ),
              );
              continue;
            }
            if (
              operation.kind === 'tool' &&
              operation.arguments !== undefined &&
              containsCredentialValue(operation.arguments)
            ) {
              diagnostics.push(
                diagnostic(
                  'MCP_CREDENTIAL_VALUE_FORBIDDEN',
                  'MCP tool arguments must reference credentials indirectly',
                  'error',
                  { operationId: operation.operationId },
                ),
              );
              continue;
            }
            try {
              const response =
                operation.kind === 'resource'
                  ? await options.client.readResource({ uri: operation.uri, signal })
                  : await options.client.callTool({
                      name: operation.tool,
                      ...(operation.arguments === undefined
                        ? {}
                        : { arguments: operation.arguments }),
                      signal,
                    });
              const normalized =
                operation.kind === 'resource'
                  ? { ...normalizeResourceResponse(response), isError: false }
                  : normalizeToolResponse(response);
              diagnostics.push(
                ...normalized.diagnostics.map((entry) => ({
                  ...entry,
                  operationId: operation.operationId,
                })),
              );
              if (
                normalized.content === undefined ||
                normalized.isError ||
                byteLength(normalized.content) > maxBytes
              ) {
                if (normalized.content !== undefined && byteLength(normalized.content) > maxBytes) {
                  diagnostics.push(
                    diagnostic(
                      'MCP_RESPONSE_TOO_LARGE',
                      'MCP response exceeded the size limit',
                      'error',
                      { operationId: operation.operationId },
                    ),
                  );
                }
                continue;
              }
              const baseLocator =
                operation.kind === 'resource' ? operation.uri : `mcp-tool:${operation.tool}`;
              records.push(
                evidenceRecord({
                  adapterId: 'mcp',
                  source,
                  locator: `${baseLocator}#operation=${encodeURIComponent(operation.operationId)}`,
                  retrievedAt,
                  content: normalized.content,
                  metadata: {
                    operationKind: operation.kind,
                    operationId: operation.operationId,
                  },
                  operationId: operation.operationId,
                }),
              );
            } catch (error) {
              diagnostics.push(
                diagnostic(failureCode(error), 'MCP collection operation failed', 'error', {
                  operationId: operation.operationId,
                }),
              );
            }
          }
          return result(records, diagnostics);
        });
      } catch (error) {
        return result([], [diagnostic(failureCode(error), 'MCP collection operation failed')]);
      }
    },
  };
}
