import { omit } from '@ls-stack/utils/objUtils';
import {
  type TestTypeIsEqual,
  typingTest,
} from '@ls-stack/utils/typingTestUtils';
import fetchMock from 'fetch-mock';
import { afterEach, assert, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { typedFetch, type TypedFetchError } from '../src/main';
import { getErrorObj, getErrorObjFromResult, getLastCall } from './utils';

beforeEach(() => {
  fetchMock.mockGlobal();
});

afterEach(() => {
  fetchMock.hardReset();
});

test('should make a successful GET request and parse the response', async () => {
  fetchMock.get('http://localhost:3000/test/path', {
    message: 'Data fetched',
  });

  const result = await typedFetch('test/path', {
    method: 'GET',
    host: 'http://localhost:3000',
    responseSchema: z.object({ message: z.string() }),
  });

  expect(getLastCall()).toMatchInlineSnapshot(`
    [
      "http://localhost:3000/test/path",
      {
        "headers": {},
        "method": "GET",
      },
    ]
  `);

  assert(result.ok);

  typingTest.expectType<
    TestTypeIsEqual<typeof result.value, { message: string }>
  >();

  expect(result.value).toMatchInlineSnapshot(`
    {
      "message": "Data fetched",
    }
  `);
});

test('should make a successful POST request with payload and parse the response', async () => {
  fetchMock.post('http://api.example.com/items', {
    id: 1,
    name: 'Test Item',
  });

  const result = await typedFetch('items', {
    method: 'POST',
    host: 'http://api.example.com',
    payload: { name: 'Test Item' },
    responseSchema: z.object({ id: z.number(), name: z.string() }),
  });

  expect(getLastCall()).toMatchInlineSnapshot(`
    [
      "http://api.example.com/items",
      {
        "headers": {
          "content-type": "application/json",
        },
        "method": "POST",
      },
    ]
  `);

  assert(result.ok);

  typingTest.expectType<
    TestTypeIsEqual<typeof result.value, { id: number; name: string }>
  >();

  expect(result.value).toEqual({ id: 1, name: 'Test Item' });
});

test('should handle requests without a response schema', async () => {
  fetchMock.get('http://localhost:8080/no/schema', {
    anyData: true,
  });

  const result = await typedFetch('no/schema', {
    method: 'GET',
    host: 'http://localhost:8080',
  });

  assert(result.ok);
  expect(result.value).toEqual({ anyData: true });
});

test('should use URL object directly', async () => {
  fetchMock.get('http://example.com/api/v1/resource', {
    success: 'ok',
  });

  const result = await typedFetch(
    new URL('http://example.com/api/v1/resource'),
    {
      method: 'GET',
      responseSchema: z.object({ success: z.string() }),
    },
  );

  expect(getLastCall()).toMatchInlineSnapshot(`
    [
      "http://example.com/api/v1/resource",
      {
        "headers": {},
        "method": "GET",
      },
    ]
  `);

  assert(result.ok);
  expect(result.value).toEqual({ success: 'ok' });
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
  fetchMock.get('http://localhost:5000/entity', {
    success: true,
  });

  await typedFetch('entity', {
    method: 'GET',
    host: 'http://localhost:5000',
    pathParams,
  });

  expect(getLastCall()).toMatchInlineSnapshot(`
    [
      "http://localhost:5000/entity?id=123&type=user&active=true&enabled=false&tags=a%2Cb",
      {
        "headers": {},
        "method": "GET",
      },
    ]
  `);
});

test('should include json path parameters in the URL', async () => {
  fetchMock.get('http://localhost:5000/entity', {
    success: true,
  });

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

  expect(getLastCall()).toMatchInlineSnapshot(`
    [
      "http://localhost:5000/entity?data=%7B%22id%22%3A123%2C%22type%22%3A%22user%22%7D",
      {
        "headers": {},
        "method": "GET",
      },
    ]
  `);

  const lastCallUrl = new URL(getLastCall()[0]);
  expect(lastCallUrl.searchParams.get('data')).toMatchInlineSnapshot(`
    "{"id":123,"type":"user"}"
  `);
});

test('should include headers in the request', async () => {
  fetchMock.get('http://localhost:5000/entity', {
    success: true,
  });

  await typedFetch('entity', {
    method: 'GET',
    host: 'http://localhost:5000',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': '1234567890',
    },
  });

  expect(getLastCall()).toMatchInlineSnapshot(`
    [
      "http://localhost:5000/entity",
      {
        "headers": {
          "content-type": "application/json",
          "x-api-key": "1234567890",
        },
        "method": "GET",
      },
    ]
  `);
});

test('handle full url as string', async () => {
  fetchMock.get('http://test.com/test', {
    body: { data: 'success' },
    status: 200,
  });

  const result = await typedFetch('http://test.com/test', {
    method: 'GET',
  });

  assert(result.ok);

  expect(result.value).toEqual({ data: 'success' });

  expect(getLastCall()).toMatchInlineSnapshot(`
    [
      "http://test.com/test",
      {
        "headers": {},
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
        "id": "invalid_options",
        "message": "Path "/leading/slash" should not start or end with /",
        "method": "GET",
        "status": 0,
        "url": "http://test.com/leading/slash",
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
        "id": "invalid_options",
        "message": "Path "trailing/slash/" should not start or end with /",
        "method": "GET",
        "status": 0,
        "url": "http://test.com/trailing/slash/",
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
        "id": "invalid_options",
        "message": "Path "double//slash" should not contain //",
        "method": "GET",
        "status": 0,
        "url": "http://test.com/double//slash",
      }
    `);
  });

  test('should return an error if fetch itself fails', async () => {
    fetchMock.get('http://fail.com/network/error', {
      throws: new Error('Failed to fetch'),
    });

    const result = await typedFetch('network/error', {
      method: 'GET',
      host: 'http://fail.com',
    });

    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "cause": {
          "message": "Failed to fetch",
          "name": "Error",
        },
        "id": "network_or_cors_error",
        "message": "Failed to fetch",
        "method": "GET",
        "status": 0,
        "url": "http://fail.com/network/error",
      }
    `);
  });

  test('should return an error for non-2xx status codes', async () => {
    fetchMock.get('http://test.com/not/found', {
      status: 404,
      body: { error: 'NF' },
    });

    const result = await typedFetch('not/found', {
      method: 'GET',
      host: 'http://test.com',
    });

    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "request_error",
        "message": "Not Found",
        "method": "GET",
        "response": {
          "error": "NF",
        },
        "status": 404,
        "url": "http://test.com/not/found",
      }
    `);
  });

  test('should return an error for invalid JSON response', async () => {
    fetchMock.get('http://test.com/invalid/json', {
      body: 'This is not JSON',
    });

    const result = await typedFetch('invalid/json', {
      method: 'GET',
      host: 'http://test.com',
    });

    assert(!result.ok);
    expect(getErrorObj(result.error)).toMatchInlineSnapshot(`
      {
        "id": "invalid_json",
        "message": "Unexpected token 'T', "This is not JSON" is not valid JSON",
        "method": "GET",
        "response": "This is not JSON",
        "status": 400,
        "url": "http://test.com/invalid/json",
      }
    `);
  });

  test('should return an error if response validation fails', async () => {
    fetchMock.get('http://test.com/validation/fail', {
      body: { name: 'Test Name', age: 'twenty', id: [1, 2, '3'] },
    });

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
        "method": "GET",
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
        "url": "http://test.com/validation/fail",
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

    expect(result.error.id).toBe('invalid_options');
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
        "id": "invalid_options",
        "message": "Payload or multiPart is not allowed for GET or DELETE requests",
        "method": "DELETE",
        "payload": {
          "name": "Test Item",
        },
        "status": 0,
        "url": "http://test.com/test",
      }
    `);
  });

  test('getMessageFromRequestError', async () => {
    fetchMock.get('http://test.com/not/found', {
      body: { error: 'NF' },
      status: 404,
    });

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
        "method": "GET",
        "response": {
          "error": "NF",
        },
        "status": 404,
        "url": "http://test.com/not/found",
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
        "cause": {
          "message": "Invalid URL",
          "name": "TypeError",
        },
        "id": "invalid_options",
        "message": "Invalid url, path or host param: Invalid URL",
        "method": "GET",
        "status": 0,
        "url": "___/invalid-url",
      }
    `);
  });

  test('pass full url and host', async () => {
    fetchMock.any({
      data: 'success',
    });

    const result = await typedFetch('http://test.com/test', {
      method: 'GET',
      host: 'http://test.com',
    });

    expect(getErrorObjFromResult(result)).toMatchInlineSnapshot(`
      {
        "id": "invalid_options",
        "message": "Full url passed as string and host param should not be used together",
        "method": "GET",
        "status": 0,
        "url": "http://test.com/test",
      }
    `);
  });

  test('should still handle non-2xx status codes with jsonResponse false', async () => {
    fetchMock.get('http://localhost:3000/error-text', {
      status: 404,
      body: 'Page not found',
    });

    const result = await typedFetch('error-text', {
      method: 'GET',
      host: 'http://localhost:3000',
      jsonResponse: false,
    });

    assert(!result.ok);

    typingTest.expectType<
      TestTypeIsEqual<typeof result.error, TypedFetchError<string>>
    >();

    expect(getErrorObj(result.error)).toMatchObject({
      id: 'request_error',
      status: 404,
      response: 'Page not found',
    });
  });
});

describe('jsonResponse: false', () => {
  test('should return raw text response when jsonResponse is false', async () => {
    fetchMock.get('http://localhost:3000/text', {
      body: 'This is plain text response',
      headers: { 'Content-Type': 'text/plain' },
    });

    const result = await typedFetch('text', {
      method: 'GET',
      host: 'http://localhost:3000',
      jsonResponse: false,
    });

    assert(result.ok);

    typingTest.expectType<TestTypeIsEqual<typeof result.value, string>>();

    expect(result.value).toBe('This is plain text response');
  });

  test('should return raw HTML response when jsonResponse is false', async () => {
    const htmlContent = '<html><body><h1>Hello World</h1></body></html>';
    fetchMock.get('http://localhost:3000/html', {
      body: htmlContent,
      headers: { 'Content-Type': 'text/html' },
    });

    const result = await typedFetch('html', {
      method: 'GET',
      host: 'http://localhost:3000',
      jsonResponse: false,
    });

    assert(result.ok);
    expect(result.value).toBe(htmlContent);
  });

  test('should return raw response even with invalid JSON when jsonResponse is false', async () => {
    const invalidJson = '{ invalid json content }';
    fetchMock.get('http://localhost:3000/invalid-json', {
      body: invalidJson,
    });

    const result = await typedFetch('invalid-json', {
      method: 'GET',
      host: 'http://localhost:3000',
      jsonResponse: false,
    });

    assert(result.ok);
    expect(result.value).toBe(invalidJson);
  });

  test('should handle POST request with jsonResponse false', async () => {
    fetchMock.post('http://localhost:3000/submit', {
      body: 'Success: Data received',
    });

    const result = await typedFetch('submit', {
      method: 'POST',
      host: 'http://localhost:3000',
      payload: { data: 'test' },
      jsonResponse: false,
    });

    assert(result.ok);
    expect(result.value).toBe('Success: Data received');
  });

  test('should handle empty response when jsonResponse is false', async () => {
    fetchMock.get('http://localhost:3000/empty', {
      body: '',
    });

    const result = await typedFetch('empty', {
      method: 'GET',
      host: 'http://localhost:3000',
      jsonResponse: false,
    });

    assert(result.ok);
    expect(result.value).toBe('');
  });
});
