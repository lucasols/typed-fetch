import { safeJsonStringify } from '@ls-stack/utils/safeJson';
import { __LEGIT_CAST__ } from '@ls-stack/utils/saferTyping';
import { concatStrings } from '@ls-stack/utils/stringUtils';
import { Result, resultify } from '@ls-stack/utils/tsResult';
import { styleText } from 'node:util';
import { z, type ZodError } from 'zod';

let devLogId = 0;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type LogOptions = {
  indent?: number;
  hostAlias?: string;
};

type RequestPayload = Record<string, unknown> | unknown[];
type RequestPathParams = Record<
  string,
  string | number | boolean | string[] | number[] | undefined
>;

type ApiCallParams<R = unknown> = {
  method: HttpMethod;
  payload?: RequestPayload;
  pathParams?: RequestPathParams;
  headers?: Record<string, string>;
  jsonPathParams?: Record<string, unknown>;
  responseSchema?: z.ZodType<R>;
  enableLogs?: boolean | LogOptions;
  disablePathValidation?: boolean;
};

export async function typedFetch<R = unknown>(
  path: URL,
  options: ApiCallParams<R>,
): Promise<Result<R, TypedFetchError>>;
export async function typedFetch<R = unknown>(
  path: string,
  options: ApiCallParams<R> & { host: string },
): Promise<Result<R, TypedFetchError>>;
export async function typedFetch<R = unknown>(
  path: string | URL,
  {
    payload,
    responseSchema,
    method,
    host,
    pathParams,
    headers,
    jsonPathParams,
    enableLogs,
    disablePathValidation,
  }: ApiCallParams<R> & { host?: string },
): Promise<Result<R, TypedFetchError>> {
  const urlResult = resultify(() => {
    if (typeof path === 'string') {
      return new URL(path, host);
    }

    return path;
  });

  if (!urlResult.ok) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_url',
        message: urlResult.error.message,
      }),
    );
  }

  const url = urlResult.value;

  const logId = ++devLogId;

  const logEnd = enableLogs
    ? logCall(logId, url, method, enableLogs === true ? undefined : enableLogs)
    : undefined;

  if (!disablePathValidation && typeof path === 'string') {
    if (path.startsWith('/') || path.endsWith('/')) {
      return errorResult(
        new TypedFetchError({
          id: 'invalid_path',
          message: `Path "${path}" should not start or end with /`,
        }),
      );
    }

    if (url.pathname.includes('//')) {
      return errorResult(
        new TypedFetchError({
          id: 'invalid_path',
          message: `Path "${path}" should not contain //`,
        }),
      );
    }
  }

  if ((method === 'GET' || method === 'DELETE') && payload) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_payload',
        message: 'Payload is not allowed for GET or DELETE requests',
      }),
    );
  }

  if (pathParams) {
    for (const [key, value] of Object.entries(pathParams)) {
      if (value === undefined) continue;

      url.searchParams.set(key, String(value));
    }
  }

  if (jsonPathParams) {
    for (const [key, value] of Object.entries(jsonPathParams)) {
      if (value === undefined) continue;

      const jsonString = safeJsonStringify(value);

      if (!jsonString) {
        return errorResult(
          new TypedFetchError({
            id: 'invalid_payload',
            message: `Invalid JSON path parameter: ${key}`,
          }),
        );
      }

      url.searchParams.set(key, jsonString);
    }
  }

  const response = await resultify(() =>
    fetch(url, {
      headers,
      method,
      body:
        method === 'GET' ? undefined : safeJsonStringify(payload) ?? undefined,
    }),
  );

  if (!response.ok)
    return errorResult(
      new TypedFetchError({
        id: 'network_or_cors_error',
        message: response.error.message,
        cause: response.error,
      }),
    );

  const responseJSON = await response.value.text();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  const parsedResponse = resultify(() => JSON.parse(responseJSON));

  if (!parsedResponse.ok) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_json',
        cause: parsedResponse.error.cause,
        message: parsedResponse.error.message,
      }),
    );
  }

  if (response.value.status < 200 || response.value.status >= 300) {
    return errorResult(
      new TypedFetchError({
        id: 'request_error',
        message: response.value.statusText,
        status: response.value.status,
      }),
    );
  }

  if (!responseSchema) {
    logEnd?.success();

    return Result.ok(__LEGIT_CAST__<R>(parsedResponse.value));
  }

  const validResponse = responseSchema.safeParse(parsedResponse.value);

  if (!validResponse.success) {
    return errorResult(
      new TypedFetchError({
        id: 'response_validation_error',
        message: validResponse.error.message,
        cause: validResponse.error,
      }),
    );
  }

  logEnd?.success();

  return Result.ok(validResponse.data);

  function errorResult(error: TypedFetchError) {
    logEnd?.error(error.status || error.id);

    const newError = new TypedFetchError({
      ...error,
      message: error.message,
      status: error.status || 0,
      method: error.method,
      payload,
      pathParams,
      jsonPathParams,
      headers,
    });

    newError.stack = error.stack;

    return Result.err(newError);
  }
}

export class TypedFetchError extends Error {
  readonly id:
    | 'invalid_url'
    | 'invalid_path'
    | 'network_or_cors_error'
    | 'request_error'
    | 'invalid_json'
    | 'response_validation_error'
    | 'invalid_payload';
  readonly status: number;
  readonly payload: RequestPayload | undefined;
  readonly response: unknown;
  readonly pathParams: RequestPathParams | undefined;
  readonly jsonPathParams?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
  readonly method: HttpMethod | undefined;
  readonly zodError?: ZodError;

  constructor({
    id,
    method,
    message,
    status,
    response,
    payload,
    pathParams,
    jsonPathParams,
    headers,
    cause,
    zodError,
  }: {
    id: TypedFetchError['id'];
    message: string;
    method?: HttpMethod;
    status?: number;
    response?: unknown;
    payload?: RequestPayload;
    pathParams?: RequestPathParams;
    jsonPathParams?: Record<string, unknown>;
    headers?: Record<string, string>;
    cause?: unknown;
    zodError?: ZodError;
  }) {
    super(message);

    this.id = id;
    this.status = status ?? 0;
    this.payload = payload;
    this.response = response;
    this.method = method;
    this.pathParams = pathParams;
    this.jsonPathParams = jsonPathParams;
    this.headers = headers;
    this.zodError = zodError;
    this.cause = cause;
  }

  toJSON() {
    return { ...this, message: this.message };
  }
}

function logCall(
  logId: number,
  url: URL,
  method: string,
  options?: LogOptions,
) {
  function log(startTimestamp = 0, errorStatus: number | string = 0) {
    console.info(
      concatStrings(
        ' '.repeat(options?.indent ?? 0),
        !startTimestamp
          ? `${String(logId)}>>`
          : styleText(
              'bold',
              styleText(!errorStatus ? 'green' : 'red', `<<${String(logId)}`),
            ),
        ` api_call:${styleText('bold', method)} ${styleText(
          'gray',
          options?.hostAlias ?? url.hostname,
        )}${url.pathname}`,
        !!errorStatus && styleText('red', ` ${errorStatus} `),
        !!startTimestamp && [
          ' ',
          styleText('gray', readableDuration(Date.now() - startTimestamp)),
        ],
      ),
    );
  }

  log();

  const startTimestamp = Date.now();

  return {
    success: () => log(startTimestamp),
    error: (status: string | number) => log(startTimestamp, status),
  };
}

export function readableDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs}ms`;

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(2)}s`;
}
