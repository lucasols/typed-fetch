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
import { z } from 'zod';
import { typedFetch, TypedFetchError } from '../src/main';
import { getErrorObjFromResult, getLastCall } from './utils';

const testHost = 'http://test.com';
const testApiUrl = `${testHost}/api`;

beforeEach(() => {
  fetchMock.mockGlobal();
});

afterEach(() => {
  fetchMock.hardReset();
});

describe('onRequest hook', () => {
  test('should call onRequest hook before making the request', async () => {
    const onRequestSpy = vi.fn();

    fetchMock.get(testApiUrl, { success: true });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onRequest: onRequestSpy,
    });

    expect(onRequestSpy).toHaveBeenCalledTimes(1);
    expect(onRequestSpy).toHaveBeenCalledWith(
      new URL(testApiUrl),
      {
        headers: expect.any(Headers),
        method: 'GET',
        body: undefined,
        signal: undefined,
      },
      expect.objectContaining({
        host: testHost,
        method: 'GET',
      }),
      0,
    );

    assert(result.ok);
    expect(result.value).toEqual({ success: true });
  });

  test('should allow onRequest to mutate fetch options', async () => {
    const onRequestSpy = vi.fn(
      (url: URL, fetchOptions: { headers: Headers }) => {
        fetchOptions.headers.set('X-Custom-Header', 'custom-value');
        fetchOptions.headers.set('Authorization', 'Bearer token123');
      },
    );

    fetchMock.get(testApiUrl, { success: true });

    await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onRequest: onRequestSpy,
    });

    const [, callOptions] = getLastCall();
    expect(callOptions.headers).toMatchInlineSnapshot(`
      {
        "authorization": "Bearer token123",
        "x-custom-header": "custom-value",
      }
    `);
  });

  test('should handle onRequest throwing an error', async () => {
    const onRequestError = new Error('onRequest failed');
    const onRequestSpy = vi.fn(() => {
      throw onRequestError;
    });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onRequest: onRequestSpy,
    });

    expect(onRequestSpy).toHaveBeenCalledTimes(1);
    expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
      {
        "cause": {
          "message": "onRequest failed",
          "name": "Error",
        },
        "id": "on_request_error",
        "message": "onRequest failed",
        "method": "GET",
        "status": 0,
        "url": "http://test.com/api",
      }
    `);
  });

  test('should call onRequest with proper parameters for POST with payload', async () => {
    const onRequestSpy = vi.fn();
    const payload = { name: 'test', id: 123 };

    fetchMock.post(testApiUrl, { created: true });

    await typedFetch('api', {
      host: testHost,
      method: 'POST',
      payload,
      onRequest: onRequestSpy,
    });

    expect(onRequestSpy).toHaveBeenCalledWith(
      new URL(testApiUrl),
      {
        headers: expect.any(Headers),
        method: 'POST',
        body: JSON.stringify(payload),
        signal: undefined,
      },
      expect.objectContaining({
        host: testHost,
        method: 'POST',
        payload,
      }),
      0,
    );
  });

  test('should call onRequest with form data', async () => {
    const onRequestSpy = vi.fn();
    const formData = { name: 'test', file: new File(['content'], 'test.txt') };

    fetchMock.post(testApiUrl, { uploaded: true });

    await typedFetch('api', {
      host: testHost,
      method: 'POST',
      formData,
      onRequest: onRequestSpy,
    });

    expect(onRequestSpy).toHaveBeenCalledWith(
      new URL(testApiUrl),
      {
        headers: expect.any(Headers),
        method: 'POST',
        body: expect.any(FormData),
        signal: undefined,
      },
      expect.objectContaining({
        host: testHost,
        method: 'POST',
        formData,
      }),
      0,
    );
  });
});

describe('onResponse hook', () => {
  test('should call onResponse hook after receiving successful response', async () => {
    const onResponseSpy = vi.fn();

    fetchMock.get(testApiUrl, { success: true });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onResponse: onResponseSpy,
    });

    expect(onResponseSpy).toHaveBeenCalledTimes(1);
    expect(onResponseSpy).toHaveBeenCalledWith(
      expect.any(Response),
      {
        headers: expect.any(Headers),
        method: 'GET',
        body: undefined,
        signal: undefined,
      },
      expect.objectContaining({
        host: testHost,
        method: 'GET',
      }),
      0,
    );

    assert(result.ok);
    expect(result.value).toEqual({ success: true });
  });

  test('should call onResponse hook after receiving error response', async () => {
    const onResponseSpy = vi.fn();

    fetchMock.get(testApiUrl, { status: 400, body: { error: 'Bad request' } });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onResponse: onResponseSpy,
    });

    expect(onResponseSpy).toHaveBeenCalledTimes(1);
    expect(onResponseSpy).toHaveBeenCalledWith(
      expect.any(Response),
      expect.any(Object),
      expect.any(Object),
      0,
    );

    expect(result.ok).toBe(false);
  });

  test('should call onResponse with null response when using custom fetcher', async () => {
    const onResponseSpy = vi.fn();
    const customFetcher = vi.fn().mockResolvedValue({
      getText: () => Promise.resolve('{"success": true}'),
      status: 200,
      statusText: 'OK',
      ok: true,
      response: {
        headers: new Headers(),
        url: testApiUrl,
        instance: null, // Custom fetcher doesn't provide Response instance
      },
    });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      fetcher: customFetcher,
      onResponse: onResponseSpy,
    });

    expect(onResponseSpy).toHaveBeenCalledWith(
      null, // Response instance is null from custom fetcher
      expect.any(Object),
      expect.any(Object),
      0,
    );

    assert(result.ok);
    expect(result.value).toEqual({ success: true });
  });

  test('should not call onResponse when request fails with network error', async () => {
    const onResponseSpy = vi.fn();

    fetchMock.get(testApiUrl, { throws: new TypeError('Network error') });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onResponse: onResponseSpy,
    });

    expect(onResponseSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});

describe('onError hook', () => {
  test('should call onError hook when request fails with network error', async () => {
    const onErrorSpy = vi.fn();

    fetchMock.get(testApiUrl, { throws: new TypeError('Network error') });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onError: onErrorSpy,
    });

    expect(onErrorSpy).toHaveBeenCalledTimes(1);
    expect(onErrorSpy).toHaveBeenCalledWith(
      expect.any(TypedFetchError),
      {
        headers: expect.any(Headers),
        method: 'GET',
        body: undefined,
        signal: undefined,
      },
      expect.objectContaining({
        host: testHost,
        method: 'GET',
      }),
      0,
    );

    const calledError = onErrorSpy.mock.calls[0]?.[0] as TypedFetchError;
    expect(calledError.id).toBe('network_or_cors_error');
    expect(calledError.message).toBe('Network error');

    expect(result.ok).toBe(false);
  });

  test('should call onError hook when request fails with HTTP error', async () => {
    const onErrorSpy = vi.fn();

    fetchMock.get(testApiUrl, { status: 500, body: { error: 'Server error' } });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onError: onErrorSpy,
    });

    expect(onErrorSpy).toHaveBeenCalledTimes(1);

    const calledError = onErrorSpy.mock.calls[0]?.[0] as TypedFetchError;
    expect(calledError.id).toBe('request_error');
    expect(calledError.status).toBe(500);

    expect(result.ok).toBe(false);
  });

  test('should call onError hook when response validation fails', async () => {
    const onErrorSpy = vi.fn();

    fetchMock.get(testApiUrl, { invalidField: 'should be number' });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      responseSchema: z.object({ validField: z.number() }),
      onError: onErrorSpy,
    });

    expect(onErrorSpy).toHaveBeenCalledTimes(1);

    const calledError = onErrorSpy.mock.calls[0]?.[0] as TypedFetchError;
    expect(calledError.id).toBe('response_validation_error');
    expect(calledError.schemaIssues).toBeDefined();

    expect(result.ok).toBe(false);
  });

  test('should call onError hook when onRequest throws', async () => {
    const onErrorSpy = vi.fn();
    const onRequestError = new Error('onRequest failed');

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onRequest: () => {
        throw onRequestError;
      },
      onError: onErrorSpy,
    });

    expect(onErrorSpy).toHaveBeenCalledTimes(1);

    const calledError = onErrorSpy.mock.calls[0]?.[0] as TypedFetchError;
    expect(calledError.id).toBe('on_request_error');
    expect(calledError.message).toBe('onRequest failed');

    expect(result.ok).toBe(false);
  });

  test('should call onError hook when request times out', async () => {
    const onErrorSpy = vi.fn();

    fetchMock.get(testApiUrl, () => new Promise(() => {})); // Never resolves

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      timeoutMs: 50,
      onError: onErrorSpy,
    });

    expect(onErrorSpy).toHaveBeenCalledTimes(1);

    const calledError = onErrorSpy.mock.calls[0]?.[0] as TypedFetchError;
    expect(calledError.id).toBe('aborted');

    expect(result.ok).toBe(false);
  });

  test('should not call onError hook when request succeeds', async () => {
    const onErrorSpy = vi.fn();

    fetchMock.get(testApiUrl, { success: true });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onError: onErrorSpy,
    });

    expect(onErrorSpy).not.toHaveBeenCalled();
    assert(result.ok);
    expect(result.value).toEqual({ success: true });
  });

  test('should call onError only once after all retries are exhausted', async () => {
    const onErrorSpy = vi.fn();

    fetchMock.get(testApiUrl, { throws: new TypeError('Network error') });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      retry: { maxRetries: 2, delayMs: 10 },
      onError: onErrorSpy,
    });

    // Should be called only once after all retries are exhausted
    expect(onErrorSpy).toHaveBeenCalledTimes(1);

    const calledError = onErrorSpy.mock.calls[0]?.[0] as TypedFetchError;
    expect(calledError.id).toBe('network_or_cors_error');
    expect(calledError.retryAttempt).toBe(2); // Shows it was the final retry

    expect(result.ok).toBe(false);
  });
});

describe('multiple hooks interaction', () => {
  test('should call all hooks in correct order for successful request', async () => {
    const hookCalls: string[] = [];

    const onRequestSpy = vi.fn(() => hookCalls.push('onRequest'));
    const onResponseSpy = vi.fn(() => hookCalls.push('onResponse'));
    const onErrorSpy = vi.fn(() => hookCalls.push('onError'));

    fetchMock.get(testApiUrl, { success: true });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onRequest: onRequestSpy,
      onResponse: onResponseSpy,
      onError: onErrorSpy,
    });

    expect(hookCalls).toEqual(['onRequest', 'onResponse']);
    expect(onErrorSpy).not.toHaveBeenCalled();

    assert(result.ok);
    expect(result.value).toEqual({ success: true });
  });

  test('should call hooks in correct order for failed request', async () => {
    const hookCalls: string[] = [];

    const onRequestSpy = vi.fn(() => hookCalls.push('onRequest'));
    const onResponseSpy = vi.fn(() => hookCalls.push('onResponse'));
    const onErrorSpy = vi.fn(() => hookCalls.push('onError'));

    fetchMock.get(testApiUrl, { status: 400, body: { error: 'Bad request' } });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onRequest: onRequestSpy,
      onResponse: onResponseSpy,
      onError: onErrorSpy,
    });

    expect(hookCalls).toEqual(['onRequest', 'onResponse', 'onError']);
    expect(result.ok).toBe(false);
  });

  test('should not call onResponse when onRequest throws', async () => {
    const hookCalls: string[] = [];

    const onRequestSpy = vi.fn(() => {
      hookCalls.push('onRequest');
      throw new Error('onRequest failed');
    });
    const onResponseSpy = vi.fn(() => hookCalls.push('onResponse'));
    const onErrorSpy = vi.fn(() => hookCalls.push('onError'));

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onRequest: onRequestSpy,
      onResponse: onResponseSpy,
      onError: onErrorSpy,
    });

    expect(hookCalls).toEqual(['onRequest', 'onError']);
    expect(onResponseSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  test('should not call onError when onResponse throws', async () => {
    const hookCalls: string[] = [];

    const onRequestSpy = vi.fn(() => hookCalls.push('onRequest'));
    const onResponseSpy = vi.fn(() => {
      hookCalls.push('onResponse');
      throw new Error('onResponse failed');
    });
    const onErrorSpy = vi.fn(() => hookCalls.push('onError'));

    fetchMock.get(testApiUrl, { success: true });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      onRequest: onRequestSpy,
      onResponse: onResponseSpy,
      onError: onErrorSpy,
    });

    expect(hookCalls).toEqual(['onRequest', 'onResponse']);
    expect(onErrorSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

describe('hooks with retry logic', () => {
  test('should call onRequest for each attempt but onError only after final failure', async () => {
    const onRequestCalls: number[] = [];
    const onErrorCalls: number[] = [];

    const onRequestSpy = vi.fn(() => onRequestCalls.push(Date.now()));
    const onErrorSpy = vi.fn(() => onErrorCalls.push(Date.now()));

    fetchMock.get(testApiUrl, { throws: new TypeError('Network error') });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      retry: { maxRetries: 2, delayMs: 10 },
      onRequest: onRequestSpy,
      onError: onErrorSpy,
    });

    expect(onRequestSpy).toHaveBeenCalledTimes(3); // Initial + 2 retries
    expect(onErrorSpy).toHaveBeenCalledTimes(1); // Only after final failure
    expect(result.ok).toBe(false);
  });

  test('should call onResponse when retry eventually succeeds', async () => {
    const onRequestSpy = vi.fn();
    const onResponseSpy = vi.fn();
    const onErrorSpy = vi.fn();

    fetchMock
      .getOnce(testApiUrl, { throws: new TypeError('Network error') })
      .getOnce(testApiUrl, { throws: new TypeError('Network error') })
      .getOnce(testApiUrl, { success: true });

    const result = await typedFetch('api', {
      host: testHost,
      method: 'GET',
      retry: { maxRetries: 3, delayMs: 10 },
      onRequest: onRequestSpy,
      onResponse: onResponseSpy,
      onError: onErrorSpy,
    });

    expect(onRequestSpy).toHaveBeenCalledTimes(3); // 2 failures + 1 success
    expect(onResponseSpy).toHaveBeenCalledTimes(1); // Only successful response
    expect(onErrorSpy).toHaveBeenCalledTimes(0); // Not called when eventually successful

    assert(result.ok);
    expect(result.value).toEqual({ success: true });
  });
});
