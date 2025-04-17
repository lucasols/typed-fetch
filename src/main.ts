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
  logFn?: TypedFetchLogger;
};

type RequestPayload = Record<string, unknown> | unknown[];
type RequestPathParams = Record<
  string,
  string | number | boolean | string[] | number[] | undefined
>;

type ApiCallParams<R = unknown, E = unknown> = {
  method: HttpMethod;
  payload?: RequestPayload;
  pathParams?: RequestPathParams;
  headers?: Record<string, string>;
  jsonPathParams?: Record<string, unknown>;
  multiPart?: Record<
    string,
    string | File | File[] | RequestPayload | undefined
  >;
  responseSchema?: z.ZodType<R>;
  enableLogs?: boolean | LogOptions;
  disablePathValidation?: boolean;
  errorResponseSchema?: z.ZodType<E>;
  getMessageFromRequestError?: (errorResponse: E) => string;
};

export async function typedFetch<R = unknown, E = unknown>(
  path: URL,
  options: ApiCallParams<R, E>,
): Promise<Result<R, TypedFetchError<E>>>;
export async function typedFetch<R = unknown, E = unknown>(
  path: string,
  options: ApiCallParams<R, E> & { host: string },
): Promise<Result<R, TypedFetchError<E>>>;
export async function typedFetch<R = unknown, E = unknown>(
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
    errorResponseSchema,
    getMessageFromRequestError,
    multiPart,
  }: ApiCallParams<R, E> & { host?: string },
): Promise<Result<R, TypedFetchError<E>>> {
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

  const logEnd = enableLogs
    ? logCall(
        ++devLogId,
        url,
        method,
        enableLogs === true ? undefined : enableLogs,
      )
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

  if (payload && multiPart) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_payload',
        message: 'Cannot use both payload and multiPart',
      }),
    );
  }

  if ((method === 'GET' || method === 'DELETE') && (payload || multiPart)) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_payload',
        message:
          'Payload or multiPart is not allowed for GET or DELETE requests',
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

  const finalHeaders = { ...headers };
  let body: BodyInit | undefined;

  if (multiPart) {
    const formData = new FormData();

    for (const [key, value] of Object.entries(multiPart)) {
      if (value === undefined) continue;

      if (value instanceof File) {
        formData.append(key, value);
      } else if (Array.isArray(value) && value[0] instanceof File) {
        for (const file of value) {
          if (file instanceof File) {
            formData.append(key, file);
          }
        }
      } else if (typeof value === 'object') {
        // Handle JSON objects by stringifying them and sending as text
        const jsonString = safeJsonStringify(value);
        if (jsonString !== undefined) {
          formData.append(key, jsonString);
        } else {
          // Handle potential stringification errors
          return errorResult(
            new TypedFetchError({
              id: 'invalid_payload',
              message: `Could not stringify value for multipart key: ${key}`,
            }),
          );
        }
      } else {
        formData.append(key, String(value));
      }
    }
    body = formData;
    // Let the browser set the Content-Type for multipart/form-data
    delete finalHeaders['Content-Type'];
    delete finalHeaders['content-type'];
  } else if (payload) {
    body = safeJsonStringify(payload) ?? undefined;
    if (!finalHeaders['Content-Type'] && !finalHeaders['content-type']) {
      finalHeaders['Content-Type'] = 'application/json';
    }
  }

  const response = await resultify(() =>
    fetch(url, {
      headers: finalHeaders,
      method,
      body,
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

  const responseJSON = await resultify(() => response.value.text());

  if (!responseJSON.ok) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_json',
        cause: responseJSON.error.cause,
        message: responseJSON.error.message,
        status: response.value.status,
      }),
    );
  }

  const parsedResponse = resultify(
    () => JSON.parse(responseJSON.value) as unknown,
  );

  if (!parsedResponse.ok) {
    return errorResult(
      new TypedFetchError<E>({
        id: 'invalid_json',
        cause: parsedResponse.error.cause,
        message: parsedResponse.error.message,
        response: responseJSON.value,
        status: 400,
      }),
    );
  }

  if (!response.value.ok) {
    const errorResponse = errorResponseSchema
      ? errorResponseSchema.safeParse(parsedResponse.value)
      : undefined;

    if (errorResponse && !errorResponse.success) {
      return errorResult(
        new TypedFetchError<E>({
          id: 'response_validation_error',
          status: response.value.status,
          errResponse: errorResponse.data,
          response: parsedResponse.value,
          ...getZodErrorProps(errorResponse.error),
        }),
      );
    }

    return errorResult(
      new TypedFetchError({
        id: 'request_error',
        message:
          getMessageFromRequestError && errorResponse?.data
            ? getMessageFromRequestError(errorResponse.data)
            : response.value.statusText,
        status: response.value.status,
        response: parsedResponse.value,
        errResponse: errorResponse?.data,
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
      new TypedFetchError<E>({
        id: 'response_validation_error',
        errResponse: errorResponseSchema
          ? errorResponseSchema.safeParse(parsedResponse.value).data
          : undefined,
        response: parsedResponse.value,
        status: response.value.status,
        ...getZodErrorProps(validResponse.error),
      }),
    );
  }

  logEnd?.success();

  return Result.ok(validResponse.data);

  function errorResult(error: TypedFetchError<E>) {
    logEnd?.error(
      error.id === 'request_error'
        ? error.status
        : error.status
        ? `${error.id}(${error.status})`
        : error.id,
    );

    const newError = new TypedFetchError<E>({
      ...error,
      message: error.message,
      status: error.status || 0,
      errResponse: error.errResponse,
      payload,
      pathParams,
      jsonPathParams,
      headers,
    });

    newError.stack = error.stack;

    return Result.err(newError);
  }
}

export class TypedFetchError<E = unknown> extends Error {
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
  readonly errResponse: E | undefined;
  readonly pathParams: RequestPathParams | undefined;
  readonly jsonPathParams?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
  readonly method: HttpMethod | undefined;
  readonly zodError?: ZodError;
  readonly response: unknown;

  constructor({
    id,
    method,
    message,
    status,
    errResponse,
    payload,
    pathParams,
    response,
    jsonPathParams,
    headers,
    cause,
    zodError,
  }: {
    id: TypedFetchError['id'];
    message: string;
    method?: HttpMethod;
    status?: number;
    errResponse?: E | undefined;
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
    this.errResponse = errResponse;
    this.method = method;
    this.pathParams = pathParams;
    this.jsonPathParams = jsonPathParams;
    this.headers = headers;
    this.zodError = zodError;
    this.cause = cause;
    this.response = response;
  }

  toJSON() {
    return { ...this, message: this.message };
  }
}

export type TypedFetchLogger = (
  logText: string,
  logInfo: {
    startTimestamp: number;
    errorStatus: number | string;
    logId: number;
    method: string;
    url: URL;
  },
) => void;

const defaultLogFn: TypedFetchLogger = (logText) => {
  console.info(logText);
};

function logCall(
  logId: number,
  url: URL,
  method: string,
  { indent = 0, hostAlias, logFn = defaultLogFn }: LogOptions = {},
) {
  function log(startTimestamp = 0, errorStatus: number | string = 0) {
    const logText = concatStrings(
      ' '.repeat(indent),
      !startTimestamp
        ? `${String(logId)}>>`
        : styleText(
            'bold',
            styleText(!errorStatus ? 'green' : 'red', `<<${String(logId)}`),
          ),
      ` api_call:${styleText('bold', method)} ${styleText(
        'gray',
        hostAlias ?? url.host,
      )}${url.pathname}`,
      !!errorStatus && styleText('red', ` ${errorStatus} `),
      !!startTimestamp && [
        ' ',
        styleText('gray', readableDuration(Date.now() - startTimestamp)),
      ],
    );

    logFn(logText, {
      startTimestamp,
      errorStatus,
      logId,
      method,
      url,
    });
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

function getZodErrorProps(error: ZodError): {
  message: string;
  zodError: ZodError;
  cause: unknown;
} {
  return {
    message: error.issues
      .map(
        (issue) =>
          `$.${issue.path
            .map((p) => (typeof p === 'number' ? `[${p}]` : p))
            .join('.')}: ${issue.message}`,
      )
      .join('\n'),
    zodError: error,
    cause: error,
  };
}
