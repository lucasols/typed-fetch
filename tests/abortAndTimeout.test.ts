import { sleep } from '@ls-stack/utils/sleep';
import fetchMock from 'fetch-mock';
import { afterEach, assert, beforeEach, expect, test } from 'vitest';
import { typedFetch } from '../src/main';
import { getErrorObjFromResult } from './utils';

beforeEach(() => {
  fetchMock.mockGlobal();
});

afterEach(() => {
  fetchMock.hardReset();
});

test('should abort when AbortSignal is triggered before fetch', async () => {
  const controller = new AbortController();
  controller.abort();

  fetchMock.get('http://test.com/api', {
    body: { data: 'success' },
    status: 200,
  });

  const result = await typedFetch('http://test.com/api', {
    method: 'GET',
    signal: controller.signal,
  });

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [AbortError: The operation was aborted.],
      "id": "aborted",
      "message": "The operation was aborted.",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);
});

test('should abort when AbortSignal is triggered during fetch', async () => {
  const controller = new AbortController();

  fetchMock.get('http://test.com/api', { data: 'success' }, { delay: 100 });

  const resultPromise = typedFetch('http://test.com/api', {
    method: 'GET',
    signal: controller.signal,
  });

  setTimeout(() => {
    controller.abort();
  }, 50);

  const result = await resultPromise;

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [AbortError: The operation was aborted.],
      "id": "aborted",
      "message": "The operation was aborted.",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);
});

test('should timeout if the request takes longer than the specified timeout', async () => {
  fetchMock.get('http://test.com/api', { data: 'success' }, { delay: 100 });

  const promise = typedFetch('http://test.com/api', {
    method: 'GET',
    timeoutMs: 50,
  });

  const result = await promise;

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [AbortError: The operation was aborted.],
      "id": "aborted",
      "message": "The operation was aborted.",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);
});

test('should not timeout if the request completes within the specified timeout', async () => {
  fetchMock.get('http://test.com/api', { data: 'success' }, { delay: 50 });

  const promise = typedFetch('http://test.com/api', {
    method: 'GET',
    timeoutMs: 150,
  });

  const result = await promise;

  assert(result.ok);

  expect(result.value).toEqual({ data: 'success' });
});

test('should prioritize abort signal over timeout if abort occurs first', async () => {
  const controller = new AbortController();

  fetchMock.get(
    'http://test.com/api',
    { body: { data: 'success' }, status: 200 },
    { delay: 300 },
  );

  const promise = typedFetch('http://test.com/api', {
    method: 'GET',
    signal: controller.signal,
    timeoutMs: 150,
  });

  setTimeout(() => {
    controller.abort();
  }, 50);

  const result = await promise;

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [AbortError: The operation was aborted.],
      "id": "aborted",
      "message": "The operation was aborted.",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);
});

test('should prioritize timeout over abort signal if timeout occurs first', async () => {
  const controller = new AbortController();

  fetchMock.get('http://test.com/api', { data: 'success' }, { delay: 300 });

  const promise = typedFetch('http://test.com/api', {
    method: 'GET',
    signal: controller.signal,
    timeoutMs: 10,
  });

  setTimeout(() => controller.abort(), 20);

  await sleep(30);

  const result = await promise;

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [AbortError: The operation was aborted.],
      "id": "aborted",
      "message": "The operation was aborted.",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);
});

test('should handle AbortSignal already aborted when timeout is also present', async () => {
  const controller = new AbortController();
  controller.abort();

  fetchMock.get('http://test.com/api', {
    body: { data: 'success' },
    status: 200,
  });

  const promise = typedFetch('http://test.com/api', {
    method: 'GET',
    signal: controller.signal,
    timeoutMs: 100,
  });

  const result = await promise;

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [AbortError: The operation was aborted.],
      "id": "aborted",
      "message": "The operation was aborted.",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);
});

test('AbortSignal should not cause issues if aborted after fetch finishes', async () => {
  const controller = new AbortController();

  fetchMock.get(
    'http://test.com/api',
    { body: { data: 'success' }, status: 200 },
    { delay: 10 },
  );

  const promise = typedFetch('http://test.com/api', {
    method: 'GET',
    signal: controller.signal,
  });

  setTimeout(() => {
    controller.abort();
  }, 5);

  const result = await promise;

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [AbortError: The operation was aborted.],
      "id": "aborted",
      "message": "The operation was aborted.",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);
});
