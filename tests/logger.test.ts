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
import { readableDuration, typedFetch } from '../src/main';
import { getNodeLogger } from '../src/nodeLogger';

// Mock the global fetch function
global.fetch = vi.fn();

const mockFetch = vi.mocked<
  (url: URL, options: RequestInit) => Promise<Response>
>(global.fetch);

const successResponse = (body: unknown, status = 200) => {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
};

const errorResponse = (body: unknown, status = 400) => {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Bad Request',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
};

describe('Logger Tests', () => {
  let consoleMock: ReturnType<typeof vi.spyOn>;
  let dateNowMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock console.info
    consoleMock = vi.spyOn(console, 'info').mockImplementation(() => {});
    // Mock Date.now for consistent duration
    dateNowMock = vi.spyOn(Date, 'now');
    dateNowMock.mockReturnValueOnce(1000).mockReturnValueOnce(1500); // 500ms duration
    // Default fetch mock
    mockFetch.mockImplementation(() => successResponse({ message: 'Success' }));
  });

  afterEach(() => {
    consoleMock.mockRestore();
    dateNowMock.mockRestore();
  });

  test('should not log when logger is undefined', async () => {
    await typedFetch('test/path', {
      method: 'GET',
      host: 'http://localhost:3000',
    });
    expect(consoleMock).not.toHaveBeenCalled();

    await typedFetch('test/path2', {
      method: 'GET',
      host: 'http://localhost:3000',
    });
    expect(consoleMock).not.toHaveBeenCalled();
  });

  test('should log with default settings when enableLogs is true', async () => {
    await typedFetch('test/path', {
      method: 'GET',
      host: 'http://localhost:3000',
      logger: getNodeLogger(),
    });

    expect(consoleMock).toHaveBeenCalledTimes(2);
    // Use stringContaining to avoid issues with color codes
    const calls = consoleMock.mock.calls;
    expect(calls[0]?.[0]).toMatchInlineSnapshot(
      `"1>> api_call:GET localhost:3000/test/path"`,
    );
    expect(calls[1]?.[0]).toMatchInlineSnapshot(
      `"<<1 api_call:GET localhost:3000/test/path 500ms"`,
    );
  });

  test('should log with custom indent and hostAlias', async () => {
    await typedFetch('test/path', {
      method: 'POST',
      host: 'http://api.example.com',
      logger: getNodeLogger({ indent: 2, hostAlias: 'MyAPI' }),
    });

    expect(consoleMock).toHaveBeenCalledTimes(2);
    const callsWithOpts = consoleMock.mock.calls;
    expect(callsWithOpts[0]?.[0]).toMatchInlineSnapshot(
      `"  2>> api_call:POST MyAPI/test/path"`,
    );
    expect(callsWithOpts[1]?.[0]).toMatchInlineSnapshot(
      `"  <<2 api_call:POST MyAPI/test/path 500ms"`,
    );
  });

  test('should log error status correctly', async () => {
    mockFetch.mockImplementation(() =>
      errorResponse({ error: 'Bad Request' }, 400),
    );

    const result = await typedFetch('error/path', {
      method: 'GET',
      host: 'http://testerror.com',
      logger: getNodeLogger(),
    });

    assert(!result.ok);

    expect(consoleMock).toHaveBeenCalledTimes(2);
    const errorCalls = consoleMock.mock.calls;
    expect(errorCalls[0]?.[0]).toMatchInlineSnapshot(
      `"3>> api_call:GET testerror.com/error/path"`,
    );
    expect(errorCalls[1]?.[0]).toMatchInlineSnapshot(
      `"<<3 api_call:GET testerror.com/error/path 400  500ms"`,
    );
    expect(errorCalls[1]?.[0]).toContain('500ms');
  });

  test('should log non-numeric error status (error id)', async () => {
    // Simulate a validation error which uses error.id
    mockFetch.mockImplementation(() => successResponse({ unexpected: 'data' }));

    const result = await typedFetch('validation/error', {
      method: 'GET',
      host: 'http://testerror.com',
      responseSchema: z.object({ expected: z.string() }), // This will fail validation
      logger: getNodeLogger(),
    });

    assert(!result.ok);

    expect(result.error.id).toBe('response_validation_error');

    expect(consoleMock).toHaveBeenCalledTimes(2);
    const validationErrorCalls = consoleMock.mock.calls;
    expect(validationErrorCalls[0]?.[0]).toMatchInlineSnapshot(
      `"4>> api_call:GET testerror.com/validation/error"`,
    );
    expect(validationErrorCalls[1]?.[0]).toMatchInlineSnapshot(
      `"<<4 api_call:GET testerror.com/validation/error response_validation_error(200)  500ms"`,
    );
  });

  test('should use hostAlias from logOptions if provided', async () => {
    await typedFetch('test/path', {
      method: 'GET',
      host: 'http://api.example.com',
      logger: getNodeLogger(),
      logOptions: { hostAlias: 'AliasFromOptions' },
    });

    expect(consoleMock).toHaveBeenCalledTimes(2);
    const calls = consoleMock.mock.calls;
    expect(calls[0]?.[0]).toMatchInlineSnapshot(
      `"5>> api_call:GET AliasFromOptions/test/path"`,
    );
    expect(calls[1]?.[0]).toMatchInlineSnapshot(
      `"<<5 api_call:GET AliasFromOptions/test/path 500ms"`,
    );
  });
});

describe('readableDuration', () => {
  test('should format milliseconds correctly', () => {
    expect(readableDuration(50)).toBe('50ms');
    expect(readableDuration(999)).toBe('999ms');
  });

  test('should format seconds correctly', () => {
    expect(readableDuration(1000)).toBe('1.00s');
    expect(readableDuration(1500)).toBe('1.50s');
    expect(readableDuration(2345)).toBe('2.35s');
    expect(readableDuration(10000)).toBe('10.00s');
  });
});
