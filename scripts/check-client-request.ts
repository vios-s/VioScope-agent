import assert from 'node:assert/strict';
import { ApiRequestError, requestJson } from '../app/client-request';

const originalFetch = globalThis.fetch;

async function main() {
  try {
    globalThis.fetch = async () => Response.json({ value: 42 });
    assert.deepEqual(await requestJson<{ value: number }>('/ok', 'Could not load.'), { value: 42 });

    globalThis.fetch = async () => Response.json({ error: 'Permission denied.' }, { status: 403 });
    await assert.rejects(() => requestJson('/forbidden', 'Fallback message'), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.message, 'Permission denied.');
      assert.equal(error.status, 403);
      return true;
    });

    globalThis.fetch = async () => new Response('not json', { status: 502 });
    await assert.rejects(
      () => requestJson('/invalid-json', 'Invalid response.'),
      (error: unknown) => error instanceof ApiRequestError && error.message === 'Invalid response.' && error.status === 502,
    );

    globalThis.fetch = async () => {
      throw new Error('socket closed');
    };
    await assert.rejects(
      () => requestJson('/offline', 'Service unavailable.'),
      (error: unknown) => error instanceof ApiRequestError && error.message === 'Service unavailable.' && error.status === 0,
    );

    console.log('Client request check passed.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
