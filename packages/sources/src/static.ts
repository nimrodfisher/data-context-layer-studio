import { constants } from 'node:fs';
import { open, realpath, stat as nodeStat } from 'node:fs/promises';
import path from 'node:path';

import { redactSecrets } from '@context-layer/core';
import { resolveProjectPath } from '@context-layer/core/persistence';
import { parse as parseCsv } from 'csv-parse/sync';
import { parseDocument } from 'yaml';
import { z } from 'zod';

import {
  assertSafeLocator,
  byteLength,
  diagnostic,
  evidenceRecord,
  result,
  scrubPlaintext,
  stableStringify,
  validateAdapterRequest,
} from './common.js';
import type { AdapterOptions, SourceAdapter } from './types.js';

export type StaticFormat = 'markdown' | 'text' | 'json' | 'yaml' | 'csv' | 'sql';

export const StaticInputSchema = z
  .strictObject({
    format: z.enum(['markdown', 'text', 'json', 'yaml', 'csv', 'sql']),
    content: z.string().optional(),
    file: z.string().optional(),
    locator: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine(({ content, file }) => (content === undefined) !== (file === undefined), {
    message: 'Provide exactly one of content or file',
  });

export type StaticInput = z.infer<typeof StaticInputSchema>;

export interface StaticFileHandle {
  canonicalPath(): Promise<string>;
  stat(): Promise<StaticFileStat>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<number>;
  close(): Promise<void>;
}

export interface StaticFileSystem {
  realpath(filePath: string): Promise<string>;
  stat(filePath: string): Promise<StaticFileStat>;
  open(filePath: string): Promise<StaticFileHandle>;
}

export interface StaticFileStat {
  size: number;
  isFile: boolean;
  dev?: number | bigint;
  ino?: number | bigint;
}

export interface StaticAdapterOptions extends AdapterOptions {
  fs?: StaticFileSystem;
  projectRoot?: string;
  maxBytes?: number;
  maxOutputBytes?: number;
  maxRows?: number;
  maxColumns?: number;
  maxDepth?: number;
  maxYamlAliases?: number;
}

const nodeFileSystem: StaticFileSystem = {
  realpath,
  stat: async (filePath) => {
    const status = await nodeStat(filePath);
    return { size: status.size, isFile: status.isFile(), dev: status.dev, ino: status.ino };
  },
  async open(filePath) {
    let handle;
    const baseFlags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
    try {
      handle = await open(filePath, baseFlags | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if (
        constants.O_NOFOLLOW === undefined ||
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        !['EINVAL', 'ENOTSUP'].includes(String(error.code))
      ) {
        throw error;
      }
      handle = await open(filePath, baseFlags);
    }
    return {
      canonicalPath: () => realpath(filePath),
      stat: async () => {
        const status = await handle.stat();
        return {
          size: status.size,
          isFile: status.isFile(),
          dev: status.dev,
          ino: status.ino,
        };
      },
      async read(buffer, offset, length, position) {
        const { bytesRead } = await handle.read(buffer, offset, length, position);
        return bytesRead;
      },
      close: () => handle.close(),
    };
  },
};
const decoder = new TextDecoder('utf-8', { fatal: true });

class StaticFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function readToEof(handle: StaticFileHandle, maxBytes: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(maxBytes + 1);
  let total = 0;
  while (total < buffer.byteLength) {
    const remaining = buffer.byteLength - total;
    const bytesRead = await handle.read(buffer, total, remaining, total);
    if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > remaining) {
      throw new StaticFailure('STATIC_FILE_ERROR');
    }
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}

function isContained(root: string, candidate: string): boolean {
  const pathApi = path.win32.isAbsolute(root) ? path.win32 : path.posix;
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !path.win32.isAbsolute(relative) &&
      !path.posix.isAbsolute(relative))
  );
}

function assertDepth(value: unknown, maxDepth: number, depth = 0): void {
  if (depth > maxDepth) throw new StaticFailure('STATIC_DEPTH_LIMIT');
  if (Array.isArray(value)) {
    for (const entry of value) assertDepth(entry, maxDepth, depth + 1);
  } else if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) assertDepth(entry, maxDepth, depth + 1);
  }
}

function normalizeContent(
  format: StaticFormat,
  content: string,
  limits: Required<
    Pick<
      StaticAdapterOptions,
      'maxRows' | 'maxColumns' | 'maxDepth' | 'maxYamlAliases' | 'maxOutputBytes'
    >
  >,
): string {
  let parsed: unknown;
  switch (format) {
    case 'json': {
      parsed = JSON.parse(content);
      break;
    }
    case 'yaml': {
      const document = parseDocument(content);
      if (document.errors.length > 0) throw new StaticFailure('STATIC_PARSE_ERROR');
      parsed = document.toJS({ maxAliasCount: limits.maxYamlAliases });
      break;
    }
    case 'csv': {
      let columnCount = 0;
      const rows = parseCsv(content, {
        columns(headers: string[]) {
          if (new Set(headers).size !== headers.length) {
            throw new StaticFailure('STATIC_DUPLICATE_CSV_HEADER');
          }
          columnCount = headers.length;
          if (columnCount > limits.maxColumns) {
            throw new StaticFailure('STATIC_COLUMN_LIMIT');
          }
          return headers;
        },
        skip_empty_lines: true,
        bom: true,
        to: limits.maxRows + 2,
      }) as unknown[];
      if (rows.length > limits.maxRows) throw new StaticFailure('STATIC_ROW_LIMIT');
      parsed = rows;
      break;
    }
    default: {
      const normalized = scrubPlaintext(redactSecrets(content));
      if (byteLength(normalized) > limits.maxOutputBytes) {
        throw new StaticFailure('STATIC_OUTPUT_TOO_LARGE');
      }
      return normalized;
    }
  }
  assertDepth(parsed, limits.maxDepth);
  const normalized = stableStringify(redactSecrets(parsed));
  if (byteLength(normalized) > limits.maxOutputBytes) {
    throw new StaticFailure('STATIC_OUTPUT_TOO_LARGE');
  }
  return normalized;
}

async function readProjectFile(
  file: string,
  options: Required<Pick<StaticAdapterOptions, 'fs' | 'projectRoot' | 'maxBytes'>>,
): Promise<{ content: string; locator: string }> {
  const lexicalPath = resolveProjectPath(options.projectRoot, file);
  const [canonicalRootBefore, canonicalFileBefore] = await Promise.all([
    options.fs.realpath(options.projectRoot),
    options.fs.realpath(lexicalPath),
  ]);
  if (!isContained(canonicalRootBefore, canonicalFileBefore)) {
    throw new StaticFailure('STATIC_PATH_FORBIDDEN');
  }
  const handle = await options.fs.open(lexicalPath);
  try {
    const [canonicalRootAfter, canonicalFileFromHandle, canonicalFileAfter, handleStat] =
      await Promise.all([
        options.fs.realpath(options.projectRoot),
        handle.canonicalPath(),
        options.fs.realpath(lexicalPath),
        handle.stat(),
      ]);
    const pathStat = await options.fs.stat(canonicalFileAfter);
    const pathApi = path.win32.isAbsolute(canonicalRootAfter) ? path.win32 : path.posix;
    const samePath = (left: string, right: string): boolean => {
      const normalizedLeft = pathApi.resolve(left);
      const normalizedRight = pathApi.resolve(right);
      return pathApi === path.win32
        ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
        : normalizedLeft === normalizedRight;
    };
    const comparableIdentity =
      handleStat.dev !== undefined &&
      handleStat.ino !== undefined &&
      pathStat.dev !== undefined &&
      pathStat.ino !== undefined;
    if (
      !samePath(canonicalRootBefore, canonicalRootAfter) ||
      !samePath(canonicalFileBefore, canonicalFileAfter) ||
      !samePath(canonicalFileFromHandle, canonicalFileAfter) ||
      (comparableIdentity && (handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino))
    ) {
      throw new StaticFailure('STATIC_PATH_RACE');
    }
    if (
      !isContained(canonicalRootAfter, canonicalFileAfter) ||
      !isContained(canonicalRootAfter, canonicalFileFromHandle)
    ) {
      throw new StaticFailure('STATIC_PATH_FORBIDDEN');
    }
    if (!handleStat.isFile || !pathStat.isFile) {
      throw new StaticFailure('STATIC_NOT_REGULAR_FILE');
    }
    if (handleStat.size > options.maxBytes) throw new StaticFailure('STATIC_INPUT_TOO_LARGE');
    const bytes = await readToEof(handle, options.maxBytes);
    if (bytes.byteLength > options.maxBytes) throw new StaticFailure('STATIC_INPUT_TOO_LARGE');
    try {
      return {
        content: decoder.decode(bytes),
        locator: `file:${pathApi
          .relative(canonicalRootAfter, canonicalFileAfter)
          .split(pathApi.sep)
          .join('/')}`,
      };
    } catch {
      throw new StaticFailure('STATIC_INVALID_UTF8');
    }
  } finally {
    await handle.close();
  }
}

export function createStaticAdapter(
  options: StaticAdapterOptions = {},
): SourceAdapter<StaticInput> {
  const fs = options.fs ?? nodeFileSystem;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const limits = {
    maxOutputBytes: options.maxOutputBytes ?? maxBytes,
    maxRows: options.maxRows ?? 10_000,
    maxColumns: options.maxColumns ?? 500,
    maxDepth: options.maxDepth ?? 50,
    maxYamlAliases: options.maxYamlAliases ?? 100,
  };
  const now = options.now ?? (() => new Date());
  const specification = {
    adapterId: 'static',
    transports: ['static'] as const,
    connectionKinds: ['static'] as const,
    inputSchema: StaticInputSchema,
  };

  return {
    id: 'static',
    transports: specification.transports,
    connectionKinds: specification.connectionKinds,
    inputSchema: StaticInputSchema,
    async collect(request) {
      const validation = validateAdapterRequest(request, specification);
      if (!validation.success) return validation.result;
      const { source, input } = validation;
      try {
        let raw: string;
        let locator: string;
        if (input.file !== undefined) {
          if (options.projectRoot === undefined) {
            throw new StaticFailure('STATIC_PROJECT_ROOT_REQUIRED');
          }
          const collectedFile = await readProjectFile(input.file, {
            fs,
            projectRoot: options.projectRoot,
            maxBytes,
          });
          raw = collectedFile.content;
          locator = collectedFile.locator;
        } else {
          raw = input.content!;
          if (byteLength(raw) > maxBytes) throw new StaticFailure('STATIC_INPUT_TOO_LARGE');
          locator = input.locator ?? `inline:${input.format}`;
        }
        try {
          assertSafeLocator(locator);
        } catch {
          throw new StaticFailure('STATIC_LOCATOR_FORBIDDEN');
        }
        let content: string;
        try {
          content = normalizeContent(input.format, raw, limits);
        } catch (error) {
          if (error instanceof StaticFailure) throw error;
          throw new StaticFailure('STATIC_PARSE_ERROR');
        }
        return result(
          [
            evidenceRecord({
              adapterId: 'static',
              source,
              locator,
              retrievedAt: now().toISOString(),
              content,
              confidence: input.confidence,
              kind: input.format === 'sql' ? 'query' : 'document',
              metadata: { format: input.format, file: input.file },
            }),
          ],
          [],
        );
      } catch (error) {
        const code = error instanceof StaticFailure ? error.code : 'STATIC_FILE_ERROR';
        const message =
          code === 'STATIC_PARSE_ERROR'
            ? 'Static source content could not be parsed'
            : 'Static source could not be collected';
        return result(
          [],
          [diagnostic(code, message, 'error', { details: { sourceId: source.id } })],
        );
      }
    },
  };
}
