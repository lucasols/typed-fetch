# Typed Fetch

[![npm version](https://badge.fury.io/js/%40ls-stack%2Ftyped-fetch.svg)](https://badge.fury.io/js/%40ls-stack%2Ftyped-fetch)

A strongly-typed fetch wrapper with inferred schema validation and the Result pattern for robust error handling. Compatible with any [standardschema.dev](https://standardschema.dev/) library

## Features

- **Type Safety:** Validate request responses against a Standard Schema.
- **Result Pattern:** Explicit success (`Ok`) and failure (`Err`) handling, eliminating the need for try/catch blocks for expected errors.
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
    enableLogs: true, // Optional: Enable logging
  });

  if (result.ok) {
    console.log('User fetched successfully:', result.value);
    return result.value;
  } else {
    // Handle different error types
    const error: TypedFetchError = result.error;
    console.error(`Failed to fetch user: ${error.id} - ${error.message}`);
    if (error.id === 'response_validation_error') {
      console.error('Validation Issues:', error.zodError?.issues);
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

1.  `typedFetch<R, E>(path: URL, options: ApiCallParams<R, E>): Promise<Result<R, TypedFetchError<E>>>`
2.  `typedFetch<R, E>(path: string, options: ApiCallParams<R, E> & { host: string }): Promise<Result<R, TypedFetchError<E>>>`

**Parameters:**

- `path` (`string` | `URL`): The request path (relative if `host` is provided, absolute otherwise) or a full `URL` object. Relative paths should not start or end with `/`.
- `options` (`object`): Configuration for the request.
  - `host` (`string`, **required if `path` is string**): The base URL (e.g., `https://api.example.com`).
  - `method` (`HttpMethod`): `'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'`.
  - `payload` (`Record<string, unknown> | unknown[]`, optional): The JSON payload for methods like POST, PUT, PATCH. Automatically stringified and sets `Content-Type: application/json`.
  - `pathParams` (`Record<string, string | number | boolean | string[] | number[] | undefined>`, optional): Key-value pairs to be added as URL query parameters.
  - `jsonPathParams` (`Record<string, unknown>`, optional): Key-value pairs where values are JSON-stringified before being added as query parameters.
  - `headers` (`Record<string, string>`, optional): Custom request headers.
  - `multiPart` (`Record<string, string | File | File[] | RequestPayload | undefined>`, optional): Data for `multipart/form-data` requests. Cannot be used with `payload`. The `Content-Type` header is set automatically by the browser. JSON objects within multipart data will be stringified.
  - `responseSchema` (`z.ZodType<R>`, optional): A Standard Schema to validate the successful response body. If provided, the `Ok` result value will be typed as `R`.
  - `errorResponseSchema` (`z.ZodType<E>`, optional): A Standard Schema to validate the error response body when the request fails (e.g., 4xx, 5xx status). If provided and validation succeeds, the `errResponse` property of `TypedFetchError` will be typed as `E`.
  - `getMessageFromRequestError` (`(errorResponse: E) => string`, optional): A function to extract a user-friendly error message from the parsed error response (`errResponse`). Used when `errorResponseSchema` is provided and validation passes.
  - `enableLogs` (`boolean | LogOptions`, optional): Enable console logging for the request/response lifecycle. Can be `true` or an object with `indent`, `hostAlias`, or `logFn`.
  - `disablePathValidation` (`boolean`, optional): Disable the validation that prevents paths starting/ending with `/`.

**Returns:**

- `Promise<Result<R, TypedFetchError<E>>>`: A Promise resolving to a `Result` object:
  - `Ok<R>`: Contains the validated response data (`value`) if the request and schema validation were successful. `R` defaults to `unknown` if `responseSchema` is not provided.
  - `Err<TypedFetchError<E>>`: Contains a `TypedFetchError` object (`error`) if any error occurred (network, validation, server error, etc.).

### `TypedFetchError<E = unknown>`

Custom error class returned in the `Err` variant of the `Result`.

**Properties:**

- `id` (`'invalid_url' | 'invalid_path' | 'network_or_cors_error' | 'request_error' | 'invalid_json' | 'response_validation_error' | 'invalid_payload'`): A unique identifier for the type of error.
- `message` (`string`): A description of the error.
- `status` (`number`): The HTTP status code of the response (0 if the request didn't receive a response, e.g., network error).
- `errResponse` (`E | undefined`): The parsed error response body, validated against `errorResponseSchema` if provided.
- `response` (`unknown`): The raw, unparsed response body (if available).
- `zodError` (`ZodError | undefined`): The Standard Schema validation error object if `id` is `'response_validation_error'`. Contains detailed validation issues.
- `cause` (`unknown`): The underlying error object that caused this error (e.g., from `fetch` or `JSON.parse`).
- `payload`, `pathParams`, `jsonPathParams`, `headers`, `method`: Copies of the request parameters for debugging.

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

  result.match(
    (user) => console.log('User created:', user),
    (error) => console.error('Failed to create user:', error.id, error.message),
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

### Request with Multipart Form Data

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
      multiPart: {
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

### Custom Logging

```typescript
import { typedFetch, TypedFetchLogger } from '@ls-stack/typed-fetch';

const customLogger: TypedFetchLogger = (logText, logInfo) => {
  // Send logs to your preferred logging service
  console.log(
    `[${logInfo.logId}] ${logInfo.method} ${logInfo.url.pathname} - ${logText}`,
  );
};

async function fetchDataWithCustomLog() {
  await typedFetch('/data', {
    host: 'https://api.example.com',
    method: 'GET',
    enableLogs: {
      logFn: customLogger,
      indent: 2,
      hostAlias: 'MyAPI',
    },
  });
}
```
