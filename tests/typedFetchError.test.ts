import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { TypedFetchError } from '../src/main';

describe('TypedFetchError', () => {
  test('should correctly assign properties in the constructor', () => {
    const error = new TypedFetchError({
      id: 'request_error' as const,
      message: 'Not Found',
      status: 404,
      method: 'GET' as const,
      payload: { key: 'value' },
      pathParams: { id: '123' },
      jsonPathParams: { filter: { name: 'test' } },
      headers: { 'Content-Type': 'application/json' },
      errResponse: { detail: 'Resource not found' },
      cause: new Error('Original cause'),
    });

    expect(error.id).toBe('request_error');
    expect(error.message).toBe('Not Found');
    expect(error.status).toBe(404);
    expect(error.method).toBe('GET');
    expect(error.payload).toEqual({ key: 'value' });
    expect(error.pathParams).toEqual({ id: '123' });
    expect(error.jsonPathParams).toEqual({ filter: { name: 'test' } });
    expect(error.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(error.errResponse).toEqual({ detail: 'Resource not found' });
    expect(error.cause).toBeInstanceOf(Error); // Check instance type instead of reference equality
    expect(error.name).toBe('Error'); // Inherited from Error class
  });

  test('should set default status to 0 if not provided', () => {
    const error = new TypedFetchError({
      id: 'invalid_json',
      message: 'Failed to parse JSON',
    });

    expect(error.status).toBe(0);
  });

  test('should return a JSON representation with all properties including message', () => {
    const error = new TypedFetchError({
      id: 'response_validation_error' as const,
      message: 'Invalid response format',
      status: 500,
      cause: new Error('Validation failed'),
    });
    const json = error.toJSON();

    expect(json).toMatchInlineSnapshot(`
      {
        "cause": [Error: Validation failed],
        "errResponse": undefined,
        "headers": undefined,
        "id": "response_validation_error",
        "jsonPathParams": undefined,
        "message": "Invalid response format",
        "method": undefined,
        "pathParams": undefined,
        "payload": undefined,
        "response": undefined,
        "status": 500,
        "zodError": undefined,
      }
    `);
  });

  test('should correctly capture the cause', () => {
    const originalCause = new Error('Underlying network issue');
    const error = new TypedFetchError({
      id: 'network_or_cors_error',
      message: 'Network request failed',
      cause: originalCause,
    });

    expect(error.cause).toBe(originalCause);
  });

  test('should handle ZodError in cause if provided', () => {
    const zodError = z
      .object({
        name: z.string(),
      })
      .safeParse({
        name: 1,
      }).error;

    const error = new TypedFetchError({
      id: 'response_validation_error',
      message: 'Zod validation failed',
      cause: zodError,
      zodError,
    });

    expect(error.cause).toBe(zodError);
    expect(error.zodError).toBe(zodError);
    expect(error.message).toBe('Zod validation failed');
  });
});
