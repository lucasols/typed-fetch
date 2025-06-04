import fetchMock from 'fetch-mock';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  setTypedFetchGlobalDefaults,
  typedFetch,
  type TypedFetchFetcher,
} from '../src/main';
import { getLastCall } from './utils';

beforeEach(() => {
  fetchMock.mockGlobal();
});

afterEach(() => {
  fetchMock.hardReset();
  // Reset global defaults after each test
  setTypedFetchGlobalDefaults({
    logger: undefined,
    fetcher: undefined,
  });
});

test('should set global logger and use it in subsequent requests', async () => {
  const mockLogger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });

  fetchMock.get('http://localhost:3000/test/path', {
    message: 'Success',
  });

  // Set global logger
  setTypedFetchGlobalDefaults({
    logger: mockLogger,
  });

  // Make a request that should use the global logger
  await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
  });

  expect(mockLogger).toHaveBeenCalledTimes(1);
  expect(mockLogger).toHaveBeenCalledWith(
    expect.any(Number), // logId
    expect.any(URL), // url
    'GET', // method
    expect.any(Number), // startTimestamp
    undefined, // logOptions
  );
});

test('should set global fetcher and use it in subsequent requests', async () => {
  const mockFetcher: TypedFetchFetcher = vi.fn().mockResolvedValue({
    getText: () => Promise.resolve('{"message": "custom fetcher response"}'),
    status: 200,
    statusText: 'OK',
    ok: true,
    response: {
      headers: new Headers(),
      url: 'http://localhost:3000/test',
    },
  });

  // Set global fetcher
  setTypedFetchGlobalDefaults({
    fetcher: mockFetcher,
  });

  // Make a request that should use the global fetcher
  const result = await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
  });

  expect(mockFetcher).toHaveBeenCalledTimes(1);
  expect(mockFetcher).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      headers: expect.any(Object),
      method: 'GET',
      body: undefined,
      signal: undefined,
    }),
  );

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ message: 'custom fetcher response' });
  }
});

test('should set both global logger and fetcher together', async () => {
  const mockLogger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });

  const mockFetcher: TypedFetchFetcher = vi.fn().mockResolvedValue({
    getText: () => Promise.resolve('{"message": "custom fetcher response"}'),
    status: 200,
    statusText: 'OK',
    ok: true,
    response: {
      headers: new Headers(),
      url: 'http://localhost:3000/test',
    },
  });

  // Set both global logger and fetcher
  setTypedFetchGlobalDefaults({
    logger: mockLogger,
    fetcher: mockFetcher,
  });

  // Make a request that should use both
  const result = await typedFetch('test/path', {
    method: 'POST',
    host: 'http://localhost:3000',
    payload: { test: 'data' },
  });

  expect(mockLogger).toHaveBeenCalledTimes(1);
  expect(mockFetcher).toHaveBeenCalledTimes(1);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ message: 'custom fetcher response' });
  }
});

test('should allow overriding global defaults with request-specific options', async () => {
  const globalLogger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });

  const globalFetcher: TypedFetchFetcher = vi.fn().mockResolvedValue({
    getText: () => Promise.resolve('{"message": "global fetcher"}'),
    status: 200,
    statusText: 'OK',
    ok: true,
    response: {
      headers: new Headers(),
      url: 'http://localhost:3000/test',
    },
  });

  const requestSpecificLogger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });

  const requestSpecificFetcher: TypedFetchFetcher = vi.fn().mockResolvedValue({
    getText: () => Promise.resolve('{"message": "request specific response"}'),
    status: 200,
    statusText: 'OK',
    ok: true,
    response: {
      headers: new Headers(),
      url: 'http://localhost:3000/test',
    },
  });

  // Set global defaults
  setTypedFetchGlobalDefaults({
    logger: globalLogger,
    fetcher: globalFetcher,
  });

  // Make a request with request-specific overrides
  const result = await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
    logger: requestSpecificLogger,
    fetcher: requestSpecificFetcher,
  });

  // Should use request-specific options, not global ones
  expect(globalLogger).not.toHaveBeenCalled();
  expect(globalFetcher).not.toHaveBeenCalled();
  expect(requestSpecificLogger).toHaveBeenCalledTimes(1);
  expect(requestSpecificFetcher).toHaveBeenCalledTimes(1);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ message: 'request specific response' });
  }
});

test('should merge global defaults correctly when partially updating', async () => {
  const mockLogger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });

  const mockFetcher: TypedFetchFetcher = vi.fn().mockResolvedValue({
    getText: () => Promise.resolve('{"message": "custom fetcher response"}'),
    status: 200,
    statusText: 'OK',
    ok: true,
    response: {
      headers: new Headers(),
      url: 'http://localhost:3000/test',
    },
  });

  // First set a global logger
  setTypedFetchGlobalDefaults({
    logger: mockLogger,
  });

  // Then add a global fetcher without losing the logger
  setTypedFetchGlobalDefaults({
    fetcher: mockFetcher,
  });

  // Make a request that should use both
  await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
  });

  expect(mockLogger).toHaveBeenCalledTimes(1);
  expect(mockFetcher).toHaveBeenCalledTimes(1);
});

test('should handle undefined values in global defaults', async () => {
  fetchMock.get('http://localhost:3000/test/path', {
    message: 'Success',
  });

  // Set global defaults with undefined values (should reset)
  setTypedFetchGlobalDefaults({
    logger: undefined,
    fetcher: undefined,
  });

  // Make a request - should use default fetch and no logger
  const result = await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
  });

  expect(result.ok).toBe(true);
  expect(getLastCall()).toMatchInlineSnapshot(`
      [
        "http://localhost:3000/test/path",
        {
          "headers": {},
          "method": "GET",
        },
      ]
    `);
});

test('should persist global defaults across multiple requests', async () => {
  const mockLogger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });

  const mockFetcher: TypedFetchFetcher = vi.fn().mockResolvedValue({
    getText: () => Promise.resolve('{"message": "custom fetcher response"}'),
    status: 200,
    statusText: 'OK',
    ok: true,
    response: {
      headers: new Headers(),
      url: 'http://localhost:3000/test',
    },
  });

  // Set global defaults
  setTypedFetchGlobalDefaults({
    logger: mockLogger,
    fetcher: mockFetcher,
  });

  // Make multiple requests
  await typedFetch('test/path1', {
    method: 'GET',
    host: 'http://localhost:3000',
  });

  await typedFetch('test/path2', {
    method: 'POST',
    host: 'http://localhost:3000',
    payload: { data: 'test' },
  });

  await typedFetch('test/path3', {
    method: 'PUT',
    host: 'http://localhost:3000',
    payload: { update: 'test' },
  });

  // All requests should have used the global defaults
  expect(mockLogger).toHaveBeenCalledTimes(3);
  expect(mockFetcher).toHaveBeenCalledTimes(3);
});

test('should allow partial updates to global defaults', async () => {
  const initialLogger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });

  const initialFetcher: TypedFetchFetcher = vi.fn().mockResolvedValue({
    getText: () => Promise.resolve('{"message": "initial fetcher"}'),
    status: 200,
    statusText: 'OK',
    ok: true,
    response: {
      headers: new Headers(),
      url: 'http://localhost:3000/test',
    },
  });

  // Set initial defaults
  setTypedFetchGlobalDefaults({
    logger: initialLogger,
    fetcher: initialFetcher,
  });

  // Update only the logger
  const newLogger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });

  setTypedFetchGlobalDefaults({
    logger: newLogger,
  });

  // Make a request
  await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
  });

  // Should use new logger but keep old fetcher
  expect(newLogger).toHaveBeenCalledTimes(1);
  expect(initialLogger).not.toHaveBeenCalled();
  expect(initialFetcher).toHaveBeenCalledTimes(1);
});
test('should reset global defaults to undefined', async () => {
  const logger = vi.fn().mockReturnValue({
    success: vi.fn(),
    error: vi.fn(),
  });
  const fetcher: TypedFetchFetcher = vi.fn().mockResolvedValue({
    getText: () => Promise.resolve('{"message": "reset test"}'),
    status: 200,
    statusText: 'OK',
    ok: true,
    response: {
      headers: new Headers(),
      url: 'http://localhost:3000/test',
    },
  });

  // Set both logger and fetcher as global defaults
  setTypedFetchGlobalDefaults({
    logger,
    fetcher,
  });

  // Make a request to ensure they're used
  await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
  });
  expect(logger).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);

  // Now reset both to undefined
  setTypedFetchGlobalDefaults({
    logger: undefined,
    fetcher: undefined,
  });

  // Mock fetch for the next request (since global fetcher is now undefined)
  fetchMock.get('http://localhost:3000/test/path', {
    message: 'default fetch',
  });

  // Make another request, should NOT use previous logger/fetcher
  await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
  });

  // Logger and fetcher should not be called again
  expect(logger).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);

  // The fetch-mock should have been called for the second request
  expect(getLastCall()).toMatchInlineSnapshot(`
    [
      "http://localhost:3000/test/path",
      {
        "headers": {},
        "method": "GET",
      },
    ]
  `);
});
