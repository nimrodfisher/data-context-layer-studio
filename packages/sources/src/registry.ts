import { SourceSchema } from '@context-layer/core';

import { diagnostic, result } from './common.js';
import type { CollectRequest, CollectionResult, SourceAdapter } from './types.js';

const BUILTIN_IDS = new Set(['static', 'mcp', 'api', 'dbt']);
const NAMESPACED_ID = /^[a-z][a-z0-9.-]*:[a-z0-9][a-z0-9._-]*$/;

export class AdapterRegistry {
  readonly #adapters = new Map<string, SourceAdapter>();

  constructor(adapters: readonly SourceAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: SourceAdapter): this {
    if (!BUILTIN_IDS.has(adapter.id) && !NAMESPACED_ID.test(adapter.id)) {
      throw new Error(`Custom adapter ID "${adapter.id}" must be namespaced`);
    }
    if (this.#adapters.has(adapter.id)) {
      throw new Error(`Adapter "${adapter.id}" is already registered`);
    }
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  resolve(requestedSource: CollectRequest['source']): SourceAdapter | undefined {
    if (requestedSource.adapter !== undefined) {
      return this.#adapters.get(requestedSource.adapter);
    }
    const direct = this.#adapters.get(requestedSource.transport);
    if (direct !== undefined) return direct;
    return [...this.#adapters.values()].find((adapter) =>
      adapter.transports.includes(requestedSource.transport),
    );
  }

  async collect(request: CollectRequest | unknown): Promise<CollectionResult> {
    if (request === null || typeof request !== 'object' || !('source' in request)) {
      return result([], [diagnostic('INVALID_SOURCE', 'Source request is malformed')]);
    }
    const parsedSource = SourceSchema.safeParse(request.source);
    if (!parsedSource.success) {
      return result([], [diagnostic('INVALID_SOURCE', 'Source request is malformed')]);
    }
    const input = 'input' in request ? request.input : undefined;
    const adapter = this.resolve(parsedSource.data);
    if (adapter === undefined) {
      return result(
        [],
        [diagnostic('UNSUPPORTED_ADAPTER', 'No registered source adapter supports this source')],
      );
    }
    if (!adapter.transports.includes(parsedSource.data.transport)) {
      return result(
        [],
        [
          diagnostic(
            'ADAPTER_SOURCE_INCOMPATIBLE',
            'Selected adapter does not support the source transport',
          ),
        ],
      );
    }
    if (
      adapter.connectionKinds !== undefined &&
      !adapter.connectionKinds.includes(parsedSource.data.connection.kind)
    ) {
      return result(
        [],
        [
          diagnostic(
            'ADAPTER_CONNECTION_INCOMPATIBLE',
            'Selected adapter does not support the source connection kind',
          ),
        ],
      );
    }
    let parsedInput = input;
    if (adapter.inputSchema !== undefined) {
      const validation = adapter.inputSchema.safeParse(input);
      if (!validation.success) {
        return result(
          [],
          [diagnostic('INVALID_ADAPTER_INPUT', 'Source adapter input is malformed')],
        );
      }
      parsedInput = validation.data;
    }
    return adapter.collect({ source: parsedSource.data, input: parsedInput });
  }
}
