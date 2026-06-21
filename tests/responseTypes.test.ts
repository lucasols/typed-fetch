import {
  type TestTypeIsEqual,
  typingTest,
} from '@ls-stack/utils/typingTestUtils';
import fetchMock from 'fetch-mock';
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { typedFetch, type TypedFetchError } from '../src/main';
import { getErrorObj } from './utils';

const host = 'http://localhost:3000';

beforeEach(() => {
  fetchMock.mockGlobal();
});

afterEach(() => {
  fetchMock.hardReset();
});

describe('responseType: arrayBuffer', () => {
  test('returns the response body as an ArrayBuffer', async () => {
    fetchMock.get(`${host}/file`, {
      body: 'binary content',
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    const result = await typedFetch('file', {
      method: 'GET',
      host,
      responseType: 'arrayBuffer',
    });

    assert(result.ok);

    typingTest.expectType<TestTypeIsEqual<typeof result.value, ArrayBuffer>>();

    expect(result.value).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(result.value)).toBe('binary content');
  });

  test('non-2xx response returns request_error with the raw text body', async () => {
    fetchMock.get(`${host}/file`, {
      status: 500,
      body: 'Internal Server Error',
    });

    const result = await typedFetch('file', {
      method: 'GET',
      host,
      responseType: 'arrayBuffer',
    });

    assert(!result.ok);

    typingTest.expectType<
      TestTypeIsEqual<typeof result.error, TypedFetchError<string>>
    >();

    expect(getErrorObj(result.error)).toMatchObject({
      id: 'request_error',
      status: 500,
      response: 'Internal Server Error',
    });
  });
});

describe('responseType: blob', () => {
  test('returns the response body as a Blob', async () => {
    fetchMock.get(`${host}/file`, {
      body: 'blob content',
      headers: { 'Content-Type': 'application/pdf' },
    });

    const result = await typedFetch('file', {
      method: 'GET',
      host,
      responseType: 'blob',
    });

    assert(result.ok);

    typingTest.expectType<TestTypeIsEqual<typeof result.value, Blob>>();

    expect(result.value).toBeInstanceOf(Blob);
    expect(await result.value.text()).toBe('blob content');
  });
});

describe('responseType: bytes', () => {
  test('returns the response body as a Uint8Array', async () => {
    fetchMock.get(`${host}/file`, {
      body: 'bytes content',
    });

    const result = await typedFetch('file', {
      method: 'GET',
      host,
      responseType: 'bytes',
    });

    assert(result.ok);

    typingTest.expectType<TestTypeIsEqual<typeof result.value, Uint8Array>>();

    expect(result.value).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result.value)).toBe('bytes content');
  });
});

describe('responseType: text', () => {
  test('returns the response body as a string', async () => {
    fetchMock.get(`${host}/text`, {
      body: 'plain text',
    });

    const result = await typedFetch('text', {
      method: 'GET',
      host,
      responseType: 'text',
    });

    assert(result.ok);

    typingTest.expectType<TestTypeIsEqual<typeof result.value, string>>();

    expect(result.value).toBe('plain text');
  });
});

describe('responseType: json', () => {
  test('explicit json response type still validates the schema', async () => {
    fetchMock.get(`${host}/json`, { message: 'ok' });

    const result = await typedFetch('json', {
      method: 'GET',
      host,
      responseType: 'json',
    });

    assert(result.ok);
    expect(result.value).toEqual({ message: 'ok' });
  });
});

describe('custom fetchers', () => {
  test('errors with invalid_options when the fetcher cannot read the requested type', async () => {
    const result = await typedFetch('file', {
      method: 'GET',
      host,
      responseType: 'arrayBuffer',
      fetcher: () =>
        Promise.resolve({
          getText: () => Promise.resolve(''),
          status: 200,
          statusText: 'OK',
          ok: true,
          response: { headers: new Headers(), url: '', instance: null },
        }),
    });

    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchObject({
      id: 'invalid_options',
      message: 'The fetcher does not support the "arrayBuffer" response type',
    });
  });

  test('uses the binary getter from a custom fetcher', async () => {
    const bytes = new TextEncoder().encode('from custom');
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    const getArrayBuffer = vi.fn(() => Promise.resolve(buffer));
    const getText = vi.fn(() => Promise.resolve('should not be called'));

    const result = await typedFetch('file', {
      method: 'GET',
      host,
      responseType: 'arrayBuffer',
      fetcher: () =>
        Promise.resolve({
          getText,
          getArrayBuffer,
          status: 200,
          statusText: 'OK',
          ok: true,
          response: { headers: new Headers(), url: '', instance: null },
        }),
    });

    assert(result.ok);
    expect(getArrayBuffer).toHaveBeenCalledTimes(1);
    expect(getText).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(result.value)).toBe('from custom');
  });

  test('surfaces a response_read_error when the binary getter throws', async () => {
    const result = await typedFetch('file', {
      method: 'GET',
      host,
      responseType: 'blob',
      fetcher: () =>
        Promise.resolve({
          getText: () => Promise.resolve(''),
          getBlob: () => Promise.reject(new Error('stream interrupted')),
          status: 200,
          statusText: 'OK',
          ok: true,
          response: { headers: new Headers(), url: '', instance: null },
        }),
    });

    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchObject({
      id: 'response_read_error',
      message: 'stream interrupted',
      status: 200,
    });
  });
});
