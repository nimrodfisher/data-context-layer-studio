import { describe, expect, it } from 'vitest';

import { LimitedRequestError, readLimitedJson } from './request';

function chunkedRequest(chunks: string[], contentLength?: number): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Request('http://localhost/api/test', {
    method: 'POST',
    body: stream,
    duplex: 'half',
    ...(contentLength === undefined
      ? {}
      : { headers: { 'content-length': String(contentLength) } }),
  } as RequestInit & { duplex: 'half' });
}

describe('readLimitedJson', () => {
  it('parses chunked JSON without request.text', async () => {
    const result = await readLimitedJson(chunkedRequest(['{"name":', '"Orders"}']), 64);

    expect(result).toEqual({ name: 'Orders' });
  });

  it('rejects a declared oversized body before reading', async () => {
    await expect(readLimitedJson(chunkedRequest(['{}'], 100), 16)).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE',
      status: 413,
    });
  });

  it('cancels an undeclared body as soon as streamed bytes exceed the limit', async () => {
    await expect(
      readLimitedJson(chunkedRequest(['{"value":"', '1234567890', '"}']), 12),
    ).rejects.toBeInstanceOf(LimitedRequestError);
  });
});
