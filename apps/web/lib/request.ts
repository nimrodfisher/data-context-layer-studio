export class LimitedRequestError extends Error {
  constructor(
    public readonly code:
      | 'REQUEST_TOO_LARGE'
      | 'REQUEST_BODY_MISSING'
      | 'REQUEST_ENCODING_INVALID'
      | 'REQUEST_JSON_INVALID',
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LimitedRequestError';
  }
}

export async function readLimitedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const declaredHeader = request.headers.get('content-length');
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new LimitedRequestError('REQUEST_JSON_INVALID', 'Content-Length is invalid.', 400);
    }
    if (declared > maximumBytes) {
      throw new LimitedRequestError(
        'REQUEST_TOO_LARGE',
        `Request body exceeds the ${maximumBytes} byte limit.`,
        413,
      );
    }
  }
  if (!request.body) {
    throw new LimitedRequestError('REQUEST_BODY_MISSING', 'Request body is required.', 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new LimitedRequestError(
          'REQUEST_TOO_LARGE',
          `Request body exceeds the ${maximumBytes} byte limit.`,
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new LimitedRequestError(
      'REQUEST_ENCODING_INVALID',
      'Request body must be valid UTF-8.',
      400,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new LimitedRequestError('REQUEST_JSON_INVALID', 'Request body must be valid JSON.', 400);
  }
}
