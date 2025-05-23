# Typed Fetch

[![npm version](https://badge.fury.io/js/%40ls-stack%2Ftyped-fetch.svg)](https://badge.fury.io/js/%40ls-stack%2Ftyped-fetch)

A strongly-typed fetch wrapper with inferred schema validation and the Result pattern for robust error handling. Compatible with any [standardschema.dev](https://standardschema.dev/) library

## Features

- **Type Safety:** Validate request responses against a Standard Schema.
- **Result Pattern:** Explicit success (`Ok`) and failure (`Err`) handling, eliminating the need for try/catch blocks for expected errors. Uses [t-result](https://github.com/lucasols/t-result) under the hood.
- **Detailed Errors:** Custom `TypedFetchError` class provides comprehensive error information (status, ID, validation issues, etc.).
- **Flexible Payloads:** Supports JSON payloads and multipart/form-data.
- **Query Parameters:** Easily add simple or JSON-stringified query parameters.
- **Customizable Logging:** Built-in logging for debugging requests.
- **Path Validation:** Prevents common path formatting errors.

## Installation

```bash
npm install @ls-stack/typed-fetch
# or
yarn add @ls-stack/typed-fetch
```

## Basic Usage

```typescript
import { typedFetch, TypedFetchError } from '@ls-stack/typed-fetch';
import { getNodeLogger } from '@ls-stack/typed-fetch/nodeLogger';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;

async function getUser(userId: number): Promise<User | null> {
  const result = await typedFetch<User>(`/users/${userId}`, {
    host: 'https://api.example.com',
    method: 'GET',
    responseSchema: UserSchema, // Validate the response
    logger: getNodeLogger(), // Optional: Use the built-in Node.js logger or provide your own
  });

  if (result.ok) {
    console.log('User fetched successfully:', result.value);
    return result.value;
  } else {
    // Handle different error types
    const error = result.error;
    console.error(`Failed to fetch user: ${error.id} - ${error.message}`);
    if (error.id === 'response_validation_error') {
      console.error('Validation Issues:', error.schemaIssues);
    }
    // Handle other errors like 'network_or_cors_error', 'request_error', 'invalid_json', etc.
    return null;
  }
}

getUser(123);
```

## API

### `typedFetch<R = unknown, E = unknown>(path, options)`

Makes an HTTP request with type validation and structured error handling.

**Overloads:**

1. `typedFetch(path: string | URL, options: ApiCallParams & { jsonResponse: false }): Promise<Result<string, TypedFetchError<string>>>`
2. `typedFetch<R, E>(path: string | URL, options: ApiCallParams<E> & { jsonResponse?: true; responseSchema?: StandardSchemaV1<R>; errorResponseSchema?: StandardSchemaV1<E>; getMessageFromRequestError?: (errorResponse: E) => string; }): Promise<Result<R, TypedFetchError<E>>>`

**Parameters:**

- `path` (`string` | `URL`): The request path (relative if `host` is provided, absolute otherwise) or a full `URL` object. Relative paths should not start or end with `/`.
- `options` (`object`): Configuration for the request.
  - `host` (`string`, **required if `path` is string**): The base URL (e.g., `https://api.example.com`).
  - `method` (`HttpMethod`): `'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'`.
  - `payload` (`Record<string, unknown> | unknown[]`, optional): The JSON payload for methods like POST, PUT, PATCH. Automatically stringified and sets `Content-Type: application/json`.
  - `pathParams` (`Record<string, string | number | boolean | string[] | number[] | undefined>`, optional): Key-value pairs to be added as URL query parameters.
  - `jsonPathParams` (`Record<string, unknown>`, optional): Key-value pairs where values are JSON-stringified before being added as query parameters.
  - `headers` (`Record<string, string>`, optional): Custom request headers.
  - `formData` (`Record<string, string | File | File[] | RequestPayload | undefined> | FormData`, optional): Data for `multipart/form-data` requests. Cannot be used with `payload`. The `Content-Type` header is set automatically by the browser. JSON objects within form data will be stringified.
  - `responseSchema` (`StandardSchemaV1<R>`, optional): A Standard Schema to validate the successful response body. If provided, the `Ok` result value will be typed as `R`.
  - `errorResponseSchema` (`StandardSchemaV1<E>`, optional): A Standard Schema to validate the error response body when the request fails (e.g., 4xx, 5xx status). If provided and validation succeeds, the `errResponse` property of `TypedFetchError` will be typed as `E`.
  - `getMessageFromRequestError` (`(errorResponse: E) => string`, optional): A function to extract a user-friendly error message from the parsed error response (`errResponse`). Used when `errorResponseSchema` is provided and validation passes.
  - `jsonResponse` (`boolean`, optional): Whether to parse response as JSON. Defaults to `true`. When `false`, the response will be returned as a string.
  - `disablePathValidation` (`boolean`, optional): Disable the validation that prevents paths starting/ending with `/`.
  - `timeoutMs` (`number`, optional): Specifies the timeout for the request in milliseconds. If the request takes longer than `timeoutMs`, it will be aborted and result in a `TypedFetchError` with `id: 'timeout'`.
  - `signal` (`AbortSignal`, optional): An `AbortSignal` to allow aborting the request externally. If the request is aborted, it will result in a `TypedFetchError` with `id: 'aborted'`.
  - `retry` (`object`, optional): Configuration for retrying failed requests.
    - `maxRetries` (`number`): The maximum number of times to retry the request.
    - `delayMs` (`number | ((attempt: number) => number)`): The delay in milliseconds before the next retry. Can be a fixed number or a function that takes the current retry attempt number (1-indexed) and returns the delay.
    - `condition` (`(context: RetryContext<E>) => boolean`, optional): A function that receives a context object (`{ error: TypedFetchError<E>, retryAttempt: number, errorDuration: number }`) and returns `true` if the request should be retried, or `false` otherwise. Defaults to retrying on all retryable errors. Errors with `id: 'invalid_options'` or `'aborted'` are never retried.
    - `onRetry` (`(context: RetryContext<E>) => void`, optional): A function called before a retry attempt. Receives the same context as `condition`.
  - `fetcher` (`TypedFetchFetcher`, optional): Custom fetch implementation. Defaults to the global `fetch` function.
  - `responseIsValid` (`(response: { headers: Headers; url: string }) => Error | true`, optional): A function to validate the response before processing. Should return `true` if valid, or an `Error` if invalid.
  - `logger` (`TypedFetchLogger`, optional): Custom logger function for request/response lifecycle logging.

**Returns:**

- `Promise<Result<R, TypedFetchError<E>>>`: A Promise resolving to a `Result` object:
  - `Ok<R>`: Contains the validated response data (`value`) if the request and schema validation were successful. `R` defaults to `unknown` if `responseSchema` is not provided.
  - `Err<TypedFetchError<E>>`: Contains a `TypedFetchError` object (`error`) if any error occurred (network, validation, server error, etc.).

### `TypedFetchError<E = unknown>`

Custom error class returned in the `Err` variant of the `Result`.

**Properties:**

- `id` (`'invalid_options' | 'aborted' | 'network_or_cors_error' | 'request_error' | 'invalid_json' | 'response_validation_error' | 'timeout' | 'invalid_response'`): A unique identifier for the type of error.
- `message` (`string`): A description of the error.
- `status` (`number`): The HTTP status code of the response (0 if the request didn't receive a response, e.g., network error).
- `errResponse` (`E | undefined`): The parsed error response body, validated against `errorResponseSchema` if provided.
- `response` (`unknown`): The raw, unparsed response body (if available).
- `schemaIssues` (`readonly StandardSchemaV1.Issue[] | undefined`): An array of validation issues if `id` is `'response_validation_error'`. Each issue object contains details about the validation failure, such as the path to the invalid field and an error message. (Requires `responseSchema` or `errorResponseSchema` to be provided for the respective validation).
- `cause` (`unknown`): The underlying error object that caused this error (e.g., from `fetch` or `JSON.parse`).
- `payload`, `pathParams`, `jsonPathParams`, `headers`, `method`: Copies of the request parameters for debugging.
- `url` (`string`): The URL that was requested.
- `formData` (`Record<string, string | File | File[] | RequestPayload | undefined> | FormData | undefined`): A copy of the form data payload used in the request, if any.
- `retryAttempt` (`number | undefined`): The retry attempt number if this error occurred during a retry (1-indexed).

## Examples

### POST Request with JSON Payload

```typescript
import { typedFetch, TypedFetchError } from '@ls-stack/typed-fetch';
import { z } from 'zod';

const CreateUserSchema = z.object({ name: z.string(), email: z.string() });
const CreatedUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
});

async function createUser(name: string, email: string) {
  const result = await typedFetch<z.infer<typeof CreatedUserSchema>>('/users', {
    host: 'https://api.example.com',
    method: 'POST',
    payload: { name, email }, // Automatically stringified
    responseSchema: CreatedUserSchema,
  });

  result
    .onOk((user) => console.log('User created:', user))
    .onErr((error) =>
      console.error('Failed to create user:', error.id, error.message),
    );
}
```

### Request with Query Parameters

```typescript
import { typedFetch } from '@ls-stack/typed-fetch';
import { z } from 'zod';

const SearchParamsSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
  tags: z.array(z.string()).optional(), // Array will be stringified correctly
});

const SearchResultsSchema = z.array(
  z.object({
    /* ... result item schema ... */
  }),
);

async function searchItems(query: string, limit?: number, tags?: string[]) {
  const result = await typedFetch<z.infer<typeof SearchResultsSchema>>(
    '/search',
    {
      host: 'https://api.example.com',
      method: 'GET',
      pathParams: { query, limit, tags }, // Automatically handles array stringification
      responseSchema: SearchResultsSchema,
    },
  );
  // ... handle result ...
}
```

### Request with Form Data

```typescript
import { typedFetch } from '@ls-stack/typed-fetch';
import { z } from 'zod';

const UploadResponseSchema = z.object({ fileUrl: z.string().url() });

async function uploadFile(file: File, metadata: { description: string }) {
  const result = await typedFetch<z.infer<typeof UploadResponseSchema>>(
    '/upload',
    {
      host: 'https://api.example.com',
      method: 'POST',
      formData: {
        file: file, // The actual File object
        metadata: metadata, // JSON object, will be stringified
        otherField: 'some value',
      },
      responseSchema: UploadResponseSchema,
    },
  );
  // ... handle result ...
}
```

### Request with String Response

```typescript
import { typedFetch } from '@ls-stack/typed-fetch';

async function downloadTextFile() {
  const result = await typedFetch('/download/readme.txt', {
    host: 'https://api.example.com',
    method: 'GET',
    jsonResponse: false, // Return response as string instead of parsing JSON
  });

  if (result.ok) {
    console.log('File content:', result.value); // string
  } else {
    console.error('Download failed:', result.error.message);
  }
}
```

### Request with Timeout

```typescript
import { typedFetch } from '@ls-stack/typed-fetch';
import { z } from 'zod';

const DataSchema = z.object({ content: z.string() });

async function fetchDataWithTimeout() {
  const result = await typedFetch<z.infer<typeof DataSchema>>(
    '/slow-endpoint',
    {
      host: 'https://api.example.com',
      method: 'GET',
      responseSchema: DataSchema,
      timeoutMs: 5000, // Abort if the request takes longer than 5 seconds
    },
  );

  if (result.ok) {
    console.log('Data fetched:', result.value);
  } else {
    if (result.error.id === 'timeout') {
      console.error('Request timed out!', result.error.message);
    } else {
      console.error(
        'Failed to fetch data:',
        result.error.id,
        result.error.message,
      );
    }
  }
}
```

### Request with Automatic Retries

```typescript
import { typedFetch, TypedFetchError } from '@ls-stack/typed-fetch';
import { z } from 'zod';

const ProductSchema = z.object({ id: z.string(), name: z.string() });

async function getProductWithRetries(productId: string) {
  const result = await typedFetch<z.infer<typeof ProductSchema>>(
    `/products/${productId}`,
    {
      host: 'https://api.example.com',
      method: 'GET',
      responseSchema: ProductSchema,
      retry: {
        maxRetries: 3,
        delayMs: (attempt) => attempt * 1000, // 1s, 2s, 3s delay
        condition: (ctx) => {
          // Only retry on network errors or 5xx server errors
          return (
            ctx.error.id === 'network_or_cors_error' ||
            (ctx.error.id === 'request_error' && ctx.error.status >= 500)
          );
        },
        onRetry: (ctx) => {
          console.log(
            `Retrying request... Attempt: ${ctx.retryAttempt}, Error: ${ctx.error.id}, Duration: ${ctx.errorDuration}ms`,
          );
        },
      },
      logger: customLogger,
    },
  );

  result
    .ifOk((product) => console.log('Product data:', product))
    .ifErr((error) =>
      console.error(
        `Failed to get product after retries: ${error.id} - ${error.message}`,
      ),
    );
}
```

### Custom Logging

For Node.js environments, use the built-in `getNodeLogger` utility for styled console output:

```typescript
import { typedFetch } from '@ls-stack/typed-fetch';
import { getNodeLogger } from '@ls-stack/typed-fetch/nodeLogger';

// Use the built-in Node.js logger with styling and formatting
const nodeLogger = getNodeLogger({
  indent: 2, // Indent logs by 2 spaces
  hostAlias: 'MyAPI', // Show "MyAPI" instead of the full host URL
});

async function fetchDataWithNodeLogger() {
  await typedFetch('/data', {
    host: 'https://api.example.com',
    method: 'GET',
    logger: nodeLogger,
  });
}
```

For custom logging implementations:

```typescript
import { typedFetch, TypedFetchLogger } from '@ls-stack/typed-fetch';

const customLogger: TypedFetchLogger = (logId, url, method, startTimestamp) => {
  return {
    success: () => {
      const duration = Date.now() - startTimestamp;
      console.log(
        `[${logId}] ${method} ${url.pathname} - Success (${duration}ms)`,
      );
    },
    error: (status) => {
      const duration = Date.now() - startTimestamp;
      console.log(
        `[${logId}] ${method} ${url.pathname} - Error: ${status} (${duration}ms)`,
      );
    },
  };
};

async function fetchDataWithCustomLog() {
  await typedFetch('/data', {
    host: 'https://api.example.com',
    method: 'GET',
    logger: customLogger,
  });
}
```
