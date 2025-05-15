import fetchMock from 'fetch-mock';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { typedFetch, TypedFetchError } from '../src/main';
import { getErrorObjFromResult, getSuccessValueFromResult } from './utils';

const testHost = 'http://test.com';
const testApiUrl = `${testHost}/api`;

beforeEach(() => {
  fetchMock.mockGlobal();
});

afterEach(() => {
  fetchMock.hardReset();
});

test('should retry on network error and eventually succeed', async () => {
  fetchMock
    .getOnce(testApiUrl, {
      throws: new TypeError('Network failure'),
    })
    .getOnce(testApiUrl, {
      body: { data: 'success' },
      status: 200,
    });

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: { maxRetries: 3, delayMs: 10 },
  });

  expect(getSuccessValueFromResult(result)).toEqual({ data: 'success' });

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(2);
});

test('with condition', async () => {
  fetchMock
    .getOnce(testApiUrl, {
      body: { error: 'Server meltdown' },
      status: 500,
    })
    .getOnce(testApiUrl, {
      body: { data: 'success_after_500' },
      status: 200,
    });

  const result = await typedFetch<{ data: string }, { error: string }>(
    testApiUrl,
    {
      method: 'GET',
      retry: {
        maxRetries: 3,
        delayMs: 10,
        condition: ({ error }) => error.status === 500,
      },
    },
  );

  expect(getSuccessValueFromResult(result)).toEqual({
    data: 'success_after_500',
  });

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(2);
});

test('should return the last error if all retry attempts fail', async () => {
  fetchMock
    .getOnce(testApiUrl, {
      body: { error: 'Attempt 1 failed' },
      status: 503,
    })
    .getOnce(testApiUrl, {
      body: { error: 'Retry 1 failed' },
      status: 503,
    })
    .getOnce(testApiUrl, {
      body: { error: 'Retry 2 failed' },
      status: 504,
    })
    .getOnce(testApiUrl, {
      body: { error: 'Retry 3 failed' },
      status: 504,
    });

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: { maxRetries: 3, delayMs: 10 },
  });

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "id": "request_error",
      "message": "Gateway Timeout",
      "response": {
        "error": "Retry 3 failed",
      },
      "status": 504,
      "url": "http://test.com/api",
    }
  `);

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(4);
});

test('should not retry if retry.condition returns false', async () => {
  fetchMock.getOnce(testApiUrl, {
    body: { error: 'Critical error' },
    status: 400,
  });

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: {
      maxRetries: 3,
      delayMs: 100,
      condition: ({ error }) => error.status !== 400,
    },
  });

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "id": "request_error",
      "message": "Bad Request",
      "response": {
        "error": "Critical error",
      },
      "status": 400,
      "url": "http://test.com/api",
    }
  `);

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(1);
});

test('should respect fixed delayMs between retries', async () => {
  fetchMock
    .getOnce(
      testApiUrl,
      { status: 500, body: { error: 'Server error' } },
      { delay: 10 },
    )
    .getOnce(testApiUrl, {
      body: { data: 'success' },
      status: 200,
    });

  const startTime = Date.now();

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: { maxRetries: 2, delayMs: 200 },
  });

  const calls = fetchMock.callHistory.calls();

  expect(calls.length).toBe(2);

  expect(Date.now() - startTime).toBeGreaterThanOrEqual(200);

  expect(getSuccessValueFromResult(result)).toEqual({ data: 'success' });
});

test('should respect functional delayMs between retries', async () => {
  fetchMock
    .getOnce(testApiUrl, {
      throws: new TypeError('Network failure attempt 1'),
    })
    .getOnce(testApiUrl, {
      throws: new TypeError('Network failure attempt 2'),
    })
    .getOnce(testApiUrl, {
      body: { data: 'success' },
      status: 200,
    });

  const delayFn = vi.fn((attempt) => attempt * 10);

  const startTime = Date.now();

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: {
      maxRetries: 3,
      delayMs: delayFn,
    },
  });

  const duration = Date.now() - startTime;

  expect(duration).toBeGreaterThanOrEqual(30);

  expect(getSuccessValueFromResult(result)).toEqual({ data: 'success' });

  expect(delayFn.mock.calls).toEqual([[1], [2]]);

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(3);
});

test('should not retry if retry config is not provided', async () => {
  fetchMock.getOnce(testApiUrl, {
    throws: new TypeError('Network failure'),
  });

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
  });

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [TypeError: Network failure],
      "id": "network_or_cors_error",
      "message": "Network failure",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(1);
});

test('should attempt only once if retry.attempts is 1', async () => {
  fetchMock
    .getOnce(testApiUrl, {
      throws: new TypeError('Network failure'),
    })
    .getOnce(testApiUrl, {
      throws: new TypeError('Network failure 2'),
    })
    .getOnce(testApiUrl, {
      body: { data: 'success' },
      status: 200,
    });

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: { maxRetries: 1, delayMs: 10 },
  });

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "cause": [TypeError: Network failure 2],
      "id": "network_or_cors_error",
      "message": "Network failure 2",
      "status": 0,
      "url": "http://test.com/api",
    }
  `);

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(2);
});

test('retry.condition receives correct context', async () => {
  fetchMock
    .getOnce(
      testApiUrl,
      {
        body: { error: 'Server error' },
        status: 500,
      },
      { delay: 50 },
    )
    .getOnce(testApiUrl, {
      body: { data: 'success' },
      status: 200,
    });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const conditionFn = vi.fn((context_: { errorDuration: number }) => true);

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: {
      maxRetries: 2,
      delayMs: 50,
      condition: conditionFn,
    },
  });

  expect(getSuccessValueFromResult(result)).toEqual({ data: 'success' });

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(2);
  expect(conditionFn).toHaveBeenCalledTimes(1);

  const conditionCalledWith = conditionFn.mock.lastCall?.[0];

  expect(conditionCalledWith?.errorDuration).toBeGreaterThanOrEqual(50);

  expect(conditionFn.mock.lastCall?.[0]).toEqual({
    error: expect.any(TypedFetchError),
    retryAttempt: 1,
    errorDuration: expect.any(Number),
  });
});

test('should succeed without retry if first attempt is successful', async () => {
  fetchMock.getOnce(testApiUrl, {
    body: { data: 'immediate success' },
    status: 200,
  });

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: { maxRetries: 3, delayMs: 100 },
  });

  expect(getSuccessValueFromResult(result)).toEqual({
    data: 'immediate success',
  });

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(1);
});

test('retry condition can prevent retry even if attempts remain', async () => {
  fetchMock
    .getOnce(testApiUrl, {
      status: 500,
      body: { detail: 'server error' },
    })
    .getOnce(testApiUrl, {
      body: { data: 'success' },
      status: 200,
    });

  const conditionFn = vi.fn().mockReturnValue(false);

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: {
      maxRetries: 3,
      delayMs: 10,
      condition: conditionFn,
    },
  });

  expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
    {
      "id": "request_error",
      "message": "Internal Server Error",
      "response": {
        "detail": "server error",
      },
      "status": 500,
      "url": "http://test.com/api",
    }
  `);

  const calls = fetchMock.callHistory.calls();
  expect(calls.length).toBe(1);

  expect(conditionFn).toHaveBeenCalledTimes(1);
});

test('retry.onRetry receives correct context', async () => {
  fetchMock
    .getOnce(
      testApiUrl,
      {
        body: { error: 'Server error' },
        status: 500,
      },
      { delay: 50 },
    )
    .getOnce(
      testApiUrl,
      {
        body: { error: 'Server error' },
        status: 500,
      },
      { delay: 20 },
    )
    .getOnce(testApiUrl, {
      body: { data: 'success' },
      status: 200,
    });

  const retryDurations: number[] = [];
  const retryContexts: {
    retryAttempt: number;
    error: TypedFetchError;
  }[] = [];

  const result = await typedFetch(testApiUrl, {
    method: 'GET',
    retry: {
      maxRetries: 2,
      delayMs: 10,
      onRetry: (context) => {
        retryContexts.push({
          retryAttempt: context.retryAttempt,
          error: context.error,
        });
        retryDurations.push(context.errorDuration);
      },
    },
  });

  expect(getSuccessValueFromResult(result)).toEqual({ data: 'success' });

  expect(retryContexts).toMatchInlineSnapshot(`
    [
      {
        "error": [Error: Internal Server Error],
        "retryAttempt": 1,
      },
      {
        "error": [Error: Internal Server Error],
        "retryAttempt": 2,
      },
    ]
  `);

  expect(retryDurations[0]).toBeGreaterThanOrEqual(50);
  expect(retryDurations[1]).toBeGreaterThanOrEqual(20);
});
