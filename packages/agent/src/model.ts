import {
  AgentFailure,
  type AgentLimits,
  type ModelGenerator,
  type ModelIdentity,
  type ModelResponse,
  type StructuredOutputSchema,
} from './types.js';

const DEFAULTS = {
  timeoutMs: 15_000,
  maxPromptChars: 24_000,
  maxEvidenceChars: 8_000,
  maxOutputChars: 12_000,
  maxOutputBytes: 48_000,
  maxOutputDepth: 12,
  maxOutputNodes: 2_000,
  maxOutputStringBytes: 16_000,
  minQuoteChars: 12,
  minQuoteTokens: 3,
} as const;

export interface ResolvedLimits {
  timeoutMs: number;
  maxPromptChars: number;
  maxEvidenceChars: number;
  maxOutputChars: number;
  maxOutputBytes: number;
  maxOutputDepth: number;
  maxOutputNodes: number;
  maxOutputStringBytes: number;
  minQuoteChars: number;
  minQuoteTokens: number;
}

export function resolveLimits(limits: AgentLimits = {}): ResolvedLimits {
  const resolved = { ...DEFAULTS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new AgentFailure('INPUT_INVALID', `${name} must be a positive integer`);
    }
  }
  return resolved;
}

export function redactSecrets(input: string): string {
  return input
    .replace(/\b(?:sk|pk|rk|api)[-_][A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;"'}]+/gi,
      '$1=[REDACTED]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^@\s]+@/gi, (value) => {
      const protocol = value.slice(0, value.indexOf('://') + 3);
      return `${protocol}[REDACTED]@`;
    });
}

export function bounded(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 12))}[TRUNCATED]`;
}

function abortFailure(externalSignal: AbortSignal | undefined, timedOut: boolean): AgentFailure {
  return externalSignal?.aborted && !timedOut
    ? new AgentFailure('CANCELLED', 'Model request was cancelled')
    : new AgentFailure('MODEL_TIMEOUT', 'Model request exceeded its time limit');
}

function invalidOutput(): never {
  throw new AgentFailure('MODEL_OUTPUT_INVALID', 'Model returned unsafe structured output');
}

function validateOutputGraph(value: unknown, limits: ResolvedLimits): void {
  const active = new WeakSet<object>();
  const stack: Array<
    { kind: 'enter'; value: unknown; depth: number } | { kind: 'exit'; value: object }
  > = [{ kind: 'enter', value, depth: 0 }];
  let nodes = 0;
  let bytes = 0;
  let characters = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.kind === 'exit') {
      active.delete(current.value);
      continue;
    }
    nodes += 1;
    if (nodes > limits.maxOutputNodes || current.depth > limits.maxOutputDepth) invalidOutput();
    const entry = current.value;
    if (entry === null || typeof entry === 'boolean') {
      bytes += 5;
      characters += 5;
    } else if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) invalidOutput();
      const numberLength = String(entry).length;
      bytes += numberLength;
      characters += numberLength;
    } else if (typeof entry === 'string') {
      const stringBytes = Buffer.byteLength(entry, 'utf8');
      if (stringBytes > limits.maxOutputStringBytes) invalidOutput();
      bytes += stringBytes + 2;
      characters += entry.length + 2;
    } else if (typeof entry === 'object') {
      if (active.has(entry)) invalidOutput();
      active.add(entry);
      stack.push({ kind: 'exit', value: entry });
      let prototype: object | null;
      let keys: (string | symbol)[];
      try {
        prototype = Object.getPrototypeOf(entry);
        keys = Reflect.ownKeys(entry);
      } catch {
        invalidOutput();
      }
      if (!Array.isArray(entry) && prototype !== Object.prototype && prototype !== null) {
        invalidOutput();
      }
      if (
        keys.some((key) => typeof key !== 'string') ||
        nodes + keys.length > limits.maxOutputNodes
      ) {
        invalidOutput();
      }
      bytes += 2;
      characters += 2;
      if (Array.isArray(entry)) {
        const dataKeys = (keys as string[]).filter((key) => key !== 'length');
        if (dataKeys.some((key) => !/^(?:0|[1-9]\d*)$/.test(key))) invalidOutput();
        for (const key of dataKeys) {
          const descriptor = Reflect.getOwnPropertyDescriptor(entry, key);
          if (!descriptor || !('value' in descriptor)) invalidOutput();
          stack.push({ kind: 'enter', value: descriptor.value, depth: current.depth + 1 });
        }
      } else {
        for (const key of keys as string[]) {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) invalidOutput();
          const descriptor = Reflect.getOwnPropertyDescriptor(entry, key);
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalidOutput();
          const keyBytes = Buffer.byteLength(key, 'utf8');
          if (keyBytes > limits.maxOutputStringBytes) invalidOutput();
          bytes += keyBytes + 3;
          characters += key.length + 3;
          stack.push({ kind: 'enter', value: descriptor.value, depth: current.depth + 1 });
        }
      }
    } else {
      invalidOutput();
    }
    if (bytes > limits.maxOutputBytes || characters > limits.maxOutputChars) invalidOutput();
  }
}

function validateResponse(response: ModelResponse, limits: ResolvedLimits): void {
  validateOutputGraph(response, limits);
  if (
    !response ||
    typeof response !== 'object' ||
    !response.metadata ||
    typeof response.metadata.provider !== 'string' ||
    typeof response.metadata.model !== 'string' ||
    response.metadata.provider.length > 200 ||
    response.metadata.model.length > 200 ||
    (response.metadata.requestId !== undefined &&
      (typeof response.metadata.requestId !== 'string' || response.metadata.requestId.length > 500))
  ) {
    invalidOutput();
  }
}

export async function generateStructured<T>(options: {
  generator: ModelGenerator;
  model: ModelIdentity;
  schema: StructuredOutputSchema<T>;
  prompt: string;
  signal?: AbortSignal;
  limits?: AgentLimits;
}): Promise<{ data: T; response: ModelResponse }> {
  const limits = resolveLimits(options.limits);
  if (options.signal?.aborted) throw new AgentFailure('CANCELLED', 'Model request was cancelled');
  if (options.prompt.length > limits.maxPromptChars) {
    throw new AgentFailure('LIMIT_EXCEEDED', 'Prompt exceeds the configured size limit');
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    const providerPromise = Promise.resolve().then(() =>
      options.generator.generate({
        prompt: options.prompt,
        schema: options.schema,
        signal: controller.signal,
        timeoutMs: limits.timeoutMs,
        maxOutputChars: limits.maxOutputChars,
        model: options.model,
      }),
    );
    void providerPromise.catch(() => undefined);
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(abortFailure(options.signal, true));
      }, limits.timeoutMs);
    });
    const cancellationPromise = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        controller.abort();
        reject(abortFailure(options.signal, false));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
    });
    const response = await Promise.race([providerPromise, timeoutPromise, cancellationPromise]);
    try {
      validateResponse(response, limits);
    } catch (error) {
      if (error instanceof AgentFailure) throw error;
      invalidOutput();
    }
    let parsed: ReturnType<StructuredOutputSchema<T>['safeParse']>;
    try {
      parsed = options.schema.safeParse(response.output);
    } catch {
      invalidOutput();
    }
    if (!parsed.success) {
      throw new AgentFailure('MODEL_OUTPUT_INVALID', 'Model returned invalid structured output');
    }
    return { data: parsed.data, response };
  } catch (error) {
    if (error instanceof AgentFailure) throw error;
    if (controller.signal.aborted) throw abortFailure(options.signal, timedOut);
    throw new AgentFailure('MODEL_FAILED', 'Model generation failed');
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}
