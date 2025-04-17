import { omit } from '@ls-stack/utils/objUtils';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { typedFetch, type TypedFetchError } from '../src/main';

// Mock the global fetch function
global.fetch = vi.fn();

const mockFetch = vi.mocked<
  (url: URL, options: RequestInit) => Promise<Response>
>(global.fetch);

function getErrorObj(obj: TypedFetchError) {
  const errorObj = obj.toJSON();

  return Object.fromEntries(
    Object.entries(errorObj).filter(([, value]) => value !== undefined),
  );
}

const successResponse = (body: unknown, status = 200) => {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
};

beforeEach(() => {
  vi.resetAllMocks();
  // Default mock implementation
  mockFetch.mockImplementation(() => successResponse({ message: 'Success' }));
});

test('should make a successful GET request and parse the response', async () => {
  mockFetch.mockImplementation(() =>
    successResponse({ message: 'Data fetched' }),
  );

  const result = await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
    responseSchema: z.object({ message: z.string() }),
  });

  expect(mockFetch.mock.lastCall).toMatchInlineSnapshot(`
    [
      "http://localhost:3000/test/path",
      {
        "body": undefined,
        "headers": {},
        "method": "GET",
      },
    ]
  `);

  assert(result.ok);

  expect(result.value).toMatchInlineSnapshot(`
    {
      "message": "Data fetched",
    }
  `);
});

test('should make a successful POST request with payload and parse the response', async () => {
  mockFetch.mockImplementation(() =>
    successResponse({ id: 1, name: 'Test Item' }),
  );

  const result = await typedFetch('items', {
    method: 'POST',
    host: 'http://api.example.com',
    payload: { name: 'Test Item' },
    responseSchema: z.object({ id: z.number(), name: z.string() }),
  });

  expect(mockFetch.mock.lastCall).toMatchInlineSnapshot(`
    [
      "http://api.example.com/items",
      {
        "body": "{"name":"Test Item"}",
        "headers": {
          "Content-Type": "application/json",
        },
        "method": "POST",
      },
    ]
  `);

  assert(result.ok);

  expect(result.value).toEqual({ id: 1, name: 'Test Item' });
});

test('should handle requests without a response schema', async () => {
  mockFetch.mockImplementation(() => successResponse({ anyData: true }));

  const result = await typedFetch('no/schema', {
    method: 'GET',
    host: 'http://localhost:8080',
  });

  assert(result.ok);
  expect(result.value).toEqual({ anyData: true });
});

test('should use URL object directly', async () => {
  mockFetch.mockImplementation(() => successResponse({ status: 'ok' }));

  const result = await typedFetch(
    new URL('http://example.com/api/v1/resource'),
    {
      method: 'GET',
      responseSchema: z.object({ status: z.string() }),
    },
  );

  expect(mockFetch.mock.lastCall).toMatchInlineSnapshot(`
    [
      "http://example.com/api/v1/resource",
      {
        "body": undefined,
        "headers": {},
        "method": "GET",
      },
    ]
  `);

  assert(result.ok);
  expect(result.value).toEqual({ status: 'ok' });
});

test('should include path parameters in the URL', async () => {
  const pathParams = {
    id: 123,
    type: 'user',
    active: true,
    test: undefined,
    enabled: false,
    tags: ['a', 'b'],
  };
  mockFetch.mockImplementation(() => successResponse({ success: true }));

  await typedFetch('entity', {
    method: 'GET',
    host: 'http://localhost:5000',
    pathParams,
  });

  expect(mockFetch.mock.lastCall).toMatchInlineSnapshot(`
    [
      "http://localhost:5000/entity?id=123&type=user&active=true&enabled=false&tags=a%2Cb",
      {
        "body": undefined,
        "headers": {},
        "method": "GET",
      },
    ]
  `);
});

test('should include json path parameters in the URL', async () => {
  mockFetch.mockImplementation(() => successResponse({ success: true }));

  await typedFetch('entity', {
    method: 'GET',
    host: 'http://localhost:5000',
    jsonPathParams: {
      data: {
        id: 123,
        type: 'user',
      },
    },
  });

  expect(mockFetch.mock.lastCall).toMatchInlineSnapshot(`
    [
      "http://localhost:5000/entity?data=%7B%22id%22%3A123%2C%22type%22%3A%22user%22%7D",
      {
        "body": undefined,
        "headers": {},
        "method": "GET",
      },
    ]
  `);

  const lastCallUrl = new URL(mockFetch.mock.lastCall![0]);
  expect(lastCallUrl.searchParams.get('data')).toMatchInlineSnapshot(`
    "{"id":123,"type":"user"}"
  `);
});

test('should include headers in the request', async () => {
  mockFetch.mockImplementation(() => successResponse({ success: true }));

  await typedFetch('entity', {
    method: 'GET',
    host: 'http://localhost:5000',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': '1234567890',
    },
  });

  expect(mockFetch.mock.lastCall).toMatchInlineSnapshot(`
    [
      "http://localhost:5000/entity",
      {
        "body": undefined,
        "headers": {
          "Content-Type": "application/json",
          "X-API-Key": "1234567890",
        },
        "method": "GET",
      },
    ]
  `);
});

describe('error handling', () => {
  test('should return an error for path starting with /', async () => {
    const result = await typedFetch('/leading/slash', {
      method: 'GET',
      host: 'http://test.com',
    });
    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "invalid_path",
        "message": "Path "/leading/slash" should not start or end with /",
        "status": 0,
      }
    `);
  });

  test('should return an error for path ending with /', async () => {
    const result = await typedFetch('trailing/slash/', {
      method: 'GET',
      host: 'http://test.com',
    });
    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "invalid_path",
        "message": "Path "trailing/slash/" should not start or end with /",
        "status": 0,
      }
    `);
  });

  test('should return an error for path containing //', async () => {
    const result = await typedFetch('double//slash', {
      method: 'GET',
      host: 'http://test.com',
    });
    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "invalid_path",
        "message": "Path "double//slash" should not contain //",
        "status": 0,
      }
    `);
  });

  test('should return an error if fetch itself fails', async () => {
    mockFetch.mockImplementation(() => {
      throw new Error('Failed to fetch');
    });

    const result = await typedFetch('network/error', {
      method: 'GET',
      host: 'http://fail.com',
    });

    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "cause": [Error: Failed to fetch],
        "id": "network_or_cors_error",
        "message": "Failed to fetch",
        "status": 0,
      }
    `);
  });

  test('should return an error for non-2xx status codes', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'NF' }), {
          status: 404,
          statusText: 'Not Found',
        }),
      ),
    );

    const result = await typedFetch('not/found', {
      method: 'GET',
      host: 'http://test.com',
    });

    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "request_error",
        "message": "Not Found",
        "response": {
          "error": "NF",
        },
        "status": 404,
      }
    `);
  });

  test('should return an error for invalid JSON response', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('This is not JSON'),
        // json() would reject in a real scenario, but text() resolves
      } as Response),
    );

    const result = await typedFetch('invalid/json', {
      method: 'GET',
      host: 'http://test.com',
    });

    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "invalid_json",
        "message": "Unexpected token 'T', "This is not JSON" is not valid JSON",
        "response": "This is not JSON",
        "status": 400,
      }
    `);
  });

  test('should return an error if response validation fails', async () => {
    mockFetch.mockImplementation(() =>
      successResponse({ name: 'Test Name', age: 'twenty', id: [1, 2, '3'] }),
    );

    const result = await typedFetch('validation/fail', {
      method: 'GET',
      host: 'http://test.com',
      responseSchema: z.object({
        name: z.string(),
        age: z.number(),
        id: z.array(z.number()),
      }),
    });

    assert(!result.ok);
    expect(omit(getErrorObj(result.error), ['cause'])).toMatchInlineSnapshot(`
      {
        "id": "response_validation_error",
        "message": "$.age: Expected number, received string
      $.id.[2]: Expected number, received string",
        "response": {
          "age": "twenty",
          "id": [
            1,
            2,
            "3",
          ],
          "name": "Test Name",
        },
        "schemaIssues": [
          {
            "code": "invalid_type",
            "expected": "number",
            "message": "Expected number, received string",
            "path": [
              "age",
            ],
            "received": "string",
          },
          {
            "code": "invalid_type",
            "expected": "number",
            "message": "Expected number, received string",
            "path": [
              "id",
              2,
            ],
            "received": "string",
          },
        ],
        "status": 200,
      }
    `);
  });

  test('should return an error if payload is provided for GET request', async () => {
    const result = await typedFetch('test', {
      method: 'GET',
      host: 'http://test.com',
      payload: { name: 'Test Item' },
    });

    assert(!result.ok);

    expect(result.error.id).toBe('invalid_payload');
  });

  test('should return an error if payload is provided for DELETE request', async () => {
    const result = await typedFetch('test', {
      method: 'DELETE',
      host: 'http://test.com',
      payload: { name: 'Test Item' },
    });

    assert(!result.ok);

    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "invalid_payload",
        "message": "Payload or multiPart is not allowed for GET or DELETE requests",
        "payload": {
          "name": "Test Item",
        },
        "status": 0,
      }
    `);
  });

  test('getMessageFromRequestError', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'NF' }), {
          status: 404,
          statusText: 'Not Found',
        }),
      ),
    );

    const result = await typedFetch('not/found', {
      method: 'GET',
      host: 'http://test.com',
      errorResponseSchema: z.object({ error: z.string() }),
      getMessageFromRequestError: (response) => response.error,
    });

    assert(!result.ok);

    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "errResponse": {
          "error": "NF",
        },
        "id": "request_error",
        "message": "NF",
        "response": {
          "error": "NF",
        },
        "status": 404,
      }
    `);
  });

  test('invalid url', async () => {
    const result = await typedFetch('invalid-url', {
      method: 'GET',
      host: '___',
    });

    assert(!result.ok);

    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "invalid_url",
        "message": "Invalid URL",
        "status": 0,
      }
    `);
  });
});
