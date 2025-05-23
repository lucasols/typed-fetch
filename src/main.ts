import { cachedGetter } from '@ls-stack/utils/cache';
import { safeJsonStringify } from '@ls-stack/utils/safeJson';
import { type __LEGIT_ANY__ } from '@ls-stack/utils/saferTyping';
import { sleep } from '@ls-stack/utils/sleep';
import { concatStrings } from '@ls-stack/utils/stringUtils';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { styleText } from 'node:util';
import { Result, resultify } from 't-result';

let devLogId = 0;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type LogOptions = {
  indent?: number;
  hostAlias?: string;
  logFn?: TypedFetchLogger;
};

export type RequestPayload = Record<string, unknown> | unknown[];
export type RequestPathParams = Record<
  string,
  string | number | boolean | string[] | number[] | undefined
>;
export type RequestFormDataPayload = Record<
  string,
  string | File | File[] | RequestPayload | undefined
>;

export type TypedFetchFetcher = (
  url: URL,
  options: {
    headers: Record<string, string>;
    method: HttpMethod;
    body: FormData | string | undefined;
    signal: AbortSignal | undefined;
  },
) => Promise<{
  getText: () => Promise<string>;
  status: number;
  statusText: string;
  ok: boolean;
}>;

const originalMaxRetries: unique symbol = Symbol('originalAttempts');

type RetryContext<E> = {
  /**
   * The error that occurred, `invalid_options` and `aborted` errors are not retried
   */
  error: TypedFetchError<E>;
  retryAttempt: number;
  /**
   * The duration from the start of the request to the error
   */
  errorDuration: number;
};

type ApiCallParams<E = unknown> = {
  /**
   * The method to use for the request
   */
  method?: HttpMethod;
  /**
   * The host to use for the request
   */
  host?: string;
  /**
   * The payload to send in the request body, will be stringified to JSON
   */
  payload?: RequestPayload;
  /**
   * The path params to be used in the request url
   */
  pathParams?: RequestPathParams;
  /**
   * The headers to be used in the request
   */
  headers?: Record<string, string>;
  /**
   * The JSON path params to be used in the request url
   */
  jsonPathParams?: Record<string, unknown>;
  /**
   * The form data to be sent in the request body, can be a FormData object or an {@link RequestFormDataPayload} object
   */
  formData?: RequestFormDataPayload | FormData;
  /**
   * Enable logging of the request and response
   */
  enableLogs?: boolean | LogOptions;
  /**
   * Disable path validation
   */
  disablePathValidation?: boolean;
  /**
   * The timeout in milliseconds
   */
  timeoutMs?: number;
  /**
   * The abort signal to use for the request
   */
  signal?: AbortSignal;
  /**
   * The retry options
   */
  retry?: {
    maxRetries: number;
    /** @internal */
    [originalMaxRetries]?: number;
    delayMs: number | ((attempt: number) => number);
    condition?: (context: RetryContext<E>) => boolean;
    onRetry?: (context: RetryContext<E>) => void;
  };
  /**
   * Fetcher, the fetch implementation to use, it will use `fetch` by default
   */
  fetcher?: TypedFetchFetcher;
  /**
   * Whether to parse the response as JSON
   *
   * @default true
   */
  jsonResponse?: boolean;
};

export async function typedFetch(
  pathOrUrl: string | URL,
  options: ApiCallParams<string> & { jsonResponse: false },
): Promise<Result<string, TypedFetchError<string>>>;
export async function typedFetch<R = unknown, E = unknown>(
  pathOrUrl: string | URL,
  options: ApiCallParams<NoInfer<E>> & {
    jsonResponse?: true;
    /**
     * The schema to validate the response against
     */
    responseSchema?: StandardSchemaV1<R>;
    /**
     * The schema to validate the error response against
     */
    errorResponseSchema?: StandardSchemaV1<E>;
    /**
     * A function to get the message from the error response
     */
    getMessageFromRequestError?: (errorResponse: E) => string;
  },
): Promise<Result<R, TypedFetchError<E>>>;
export async function typedFetch(
  pathOrUrl: string | URL,
  options: ApiCallParams<__LEGIT_ANY__> & {
    jsonResponse?: boolean;
    responseSchema?: StandardSchemaV1<unknown>;
    errorResponseSchema?: StandardSchemaV1<unknown>;
    getMessageFromRequestError?: (errorResponse: unknown) => string;
  },
): Promise<Result<unknown, TypedFetchError<unknown>>> {
  const {
    payload,
    responseSchema,
    method = 'GET',
    host,
    pathParams,
    headers,
    jsonPathParams,
    enableLogs,
    disablePathValidation,
    errorResponseSchema,
    getMessageFromRequestError,
    formData,
    timeoutMs,
    signal,
    jsonResponse = true,
    retry,
    fetcher = defaultFetcher,
  } = options;

  const startTimestamp = retry || enableLogs ? Date.now() : undefined;

  const urlResult = resultify(() =>
    typeof pathOrUrl === 'string' ? new URL(pathOrUrl, host) : pathOrUrl,
  );

  if (!urlResult.ok) {
    return Result.err(
      new TypedFetchError({
        id: 'invalid_options',
        message: `Invalid url, path or host param: ${urlResult.error.message}`,
        status: 0,
        cause: urlResult.error,
        ...getGenericErrorPayload(host ? `${host}/${pathOrUrl}` : pathOrUrl),
      }),
    );
  }

  const url = urlResult.value;

  const logEnd =
    enableLogs ?
      logCall(
        ++devLogId,
        url,
        method,
        startTimestamp ?? 0,
        enableLogs === true ? undefined : enableLogs,
      )
    : undefined;

  if (!disablePathValidation && typeof pathOrUrl === 'string') {
    if (pathOrUrl.startsWith('/') || pathOrUrl.endsWith('/')) {
      return errorResult(
        new TypedFetchError({
          id: 'invalid_options',
          message: `Path "${pathOrUrl}" should not start or end with /`,
        }),
      );
    }

    if (host && pathOrUrl.includes('://')) {
      return errorResult(
        new TypedFetchError({
          id: 'invalid_options',
          message: `Full url passed as string and host param should not be used together`,
        }),
      );
    }

    if (url.pathname.includes('//')) {
      return errorResult(
        new TypedFetchError({
          id: 'invalid_options',
          message: `Path "${pathOrUrl}" should not contain //`,
        }),
      );
    }
  }

  if (payload && formData) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_options',
        message: 'Cannot use both payload and multiPart',
      }),
    );
  }

  if ((method === 'GET' || method === 'DELETE') && (payload || formData)) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_options',
        message:
          'Payload or multiPart is not allowed for GET or DELETE requests',
      }),
    );
  }

  if (jsonResponse === false && errorResponseSchema) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_options',
        message:
          'errorResponseSchema is not allowed when jsonResponse is false',
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
            id: 'invalid_options',
            message: `Invalid JSON path parameter: ${key}`,
          }),
        );
      }

      url.searchParams.set(key, jsonString);
    }
  }

  const finalHeaders = { ...headers };
  let body: FormData | string | undefined;

  if (formData instanceof FormData) {
    body = formData;
  } else if (formData) {
    const formDataFromObj = new FormData();

    for (const [key, value] of Object.entries(formData)) {
      if (value === undefined) continue;

      if (value instanceof File) {
        formDataFromObj.append(key, value);
      } else if (Array.isArray(value) && value[0] instanceof File) {
        for (const file of value) {
          if (file instanceof File) {
            formDataFromObj.append(key, file);
          }
        }
      } else if (typeof value === 'object') {
        // Handle JSON objects by stringifying them and sending as text
        const jsonString = safeJsonStringify(value);
        if (jsonString !== undefined) {
          formDataFromObj.append(key, jsonString);
        } else {
          // Handle potential stringification errors
          return errorResult(
            new TypedFetchError({
              id: 'invalid_options',
              message: `Could not stringify value for multipart key: ${key}`,
            }),
          );
        }
      } else {
        formDataFromObj.append(key, String(value));
      }
    }
    body = formDataFromObj;
    // Let the browser set the Content-Type for multipart/form-data
    delete finalHeaders['Content-Type'];
    delete finalHeaders['content-type'];
  } else if (payload) {
    body = safeJsonStringify(payload) ?? undefined;
    if (!finalHeaders['Content-Type'] && !finalHeaders['content-type']) {
      finalHeaders['Content-Type'] = 'application/json';
    }
  }

  let abortSignal: AbortSignal | undefined = signal;

  if (timeoutMs) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    abortSignal =
      abortSignal ?
        AbortSignal.any([abortSignal, timeoutSignal])
      : timeoutSignal;
  }

  const response = await resultify(() =>
    fetcher(url, {
      headers: finalHeaders,
      method,
      body,
      signal: abortSignal,
    }),
  );

  if (!response.ok) {
    const baseErrProps = {
      message: response.error.message,
      cause: response.error,
    };

    if (response.error.name === 'TimeoutError') {
      return errorResult(
        new TypedFetchError({ id: 'timeout', ...baseErrProps }),
      );
    }

    if (response.error.name === 'AbortError') {
      return errorResult(
        new TypedFetchError({ id: 'aborted', ...baseErrProps }),
      );
    }

    return errorResult(
      new TypedFetchError({ id: 'network_or_cors_error', ...baseErrProps }),
    );
  }

  const responseText = await resultify(() => response.value.getText());

  if (!responseText.ok) {
    return errorResult(
      new TypedFetchError({
        id: 'invalid_json',
        cause: responseText.error.cause,
        message: responseText.error.message,
        status: response.value.status,
      }),
    );
  }

  if (!jsonResponse) {
    if (!response.value.ok) {
      return errorResult(
        new TypedFetchError({
          id: 'request_error',
          message: response.value.statusText,
          status: response.value.status,
          response: responseText.value,
        }),
      );
    }

    logEnd?.success();
    return Result.ok(responseText.value);
  }

  const parsedResponse = resultify(
    () => JSON.parse(responseText.value) as unknown,
  );

  if (!parsedResponse.ok) {
    return errorResult(
      new TypedFetchError<unknown>({
        id: 'invalid_json',
        cause: parsedResponse.error.cause,
        message: parsedResponse.error.message,
        response: responseText.value,
        status: 400,
      }),
    );
  }

  if (!response.value.ok) {
    const errorResponse =
      errorResponseSchema ?
        standardResultValidate(errorResponseSchema, parsedResponse.value)
      : undefined;

    if (errorResponse && !errorResponse.ok) {
      return errorResult(
        new TypedFetchError<unknown>({
          id: 'response_validation_error',
          status: response.value.status,
          response: parsedResponse.value,
          ...getValidationProps(errorResponse.error),
        }),
      );
    }

    return errorResult(
      new TypedFetchError({
        id: 'request_error',
        message:
          getMessageFromRequestError && errorResponse?.value ?
            getMessageFromRequestError(errorResponse.value)
          : response.value.statusText,
        status: response.value.status,
        response: parsedResponse.value,
        errResponse: errorResponse?.value,
      }),
    );
  }

  if (!responseSchema) {
    logEnd?.success();

    return Result.ok(parsedResponse.value);
  }

  const validResponse = standardResultValidate(
    responseSchema,
    parsedResponse.value,
  );

  if (!validResponse.ok) {
    return errorResult(
      new TypedFetchError<unknown>({
        id: 'response_validation_error',
        errResponse:
          errorResponseSchema ?
            (standardResultValidate(
              errorResponseSchema,
              parsedResponse.value,
            ).unwrapOrNull() ?? undefined)
          : undefined,
        response: parsedResponse.value,
        status: response.value.status,
        ...getValidationProps(validResponse.error),
      }),
    );
  }

  logEnd?.success();

  function getGenericErrorPayload(urlUsed: URL | string) {
    return {
      payload,
      pathParams,
      jsonPathParams,
      headers,
      formData,
      method,
      url:
        typeof urlUsed === 'string' ? urlUsed : (
          `${urlUsed.protocol}//${urlUsed.host}${urlUsed.pathname}`
        ),
    };
  }

  return Result.ok(validResponse.value);

  async function errorResult(error: TypedFetchError<unknown>) {
    logEnd?.error(
      error.id === 'request_error' ? error.status
      : error.status ? `${error.id}(${error.status})`
      : error.id,
    );

    const maxAttempts = retry?.[originalMaxRetries] ?? retry?.maxRetries ?? 0;

    const retryAttempt = maxAttempts - (retry?.maxRetries ?? 0) + 1;

    const newError = new TypedFetchError<unknown>({
      ...error,
      message: error.message,
      status: error.status || 0,
      errResponse: error.errResponse,
      ...getGenericErrorPayload(url),
      retryAttempt:
        maxAttempts === 0 || retryAttempt === 1 ? undefined : retryAttempt - 1,
    });

    newError.stack = error.stack;

    const canRetryErrorId =
      error.id !== 'invalid_options' && error.id !== 'aborted';

    const errorDuration = cachedGetter(
      () => Date.now() - (startTimestamp ?? 0),
    );

    if (
      retry?.maxRetries &&
      retry.maxRetries > 0 &&
      canRetryErrorId &&
      (retry.condition?.({
        error,
        retryAttempt,
        errorDuration: errorDuration.value,
      }) ??
        true)
    ) {
      const delay =
        typeof retry.delayMs === 'function' ?
          retry.delayMs(retryAttempt)
        : retry.delayMs;

      await sleep(delay);

      retry.onRetry?.({
        error,
        retryAttempt,
        errorDuration: errorDuration.value,
      });

      const newOptions: typeof options = {
        ...options,
        retry: {
          ...retry,
          [originalMaxRetries]: maxAttempts,
          maxRetries: retry.maxRetries - 1,
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return typedFetch(pathOrUrl, newOptions as any);
    }

    return Result.err(newError);
  }
}

export class TypedFetchError<E = unknown> extends Error {
  readonly id:
    | 'invalid_options'
    | 'aborted'
    | 'network_or_cors_error'
    | 'request_error'
    | 'invalid_json'
    | 'response_validation_error'
    | 'timeout';
  readonly status: number;
  readonly payload: RequestPayload | undefined;
  readonly errResponse: E | undefined;
  readonly pathParams: RequestPathParams | undefined;
  readonly jsonPathParams: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;
  readonly method: HttpMethod | undefined;
  readonly schemaIssues: readonly StandardSchemaV1.Issue[] | undefined;
  readonly response: unknown;
  readonly url: string;
  readonly formData: RequestFormDataPayload | FormData | undefined;
  readonly retryAttempt: number | undefined;

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
    schemaIssues,
    url,
    formData,
    retryAttempt,
  }: {
    id: TypedFetchError['id'];
    message: string;
    url?: string;
    method?: HttpMethod;
    status?: number;
    errResponse?: E | undefined;
    response?: unknown;
    payload?: RequestPayload;
    pathParams?: RequestPathParams;
    jsonPathParams?: Record<string, unknown>;
    headers?: Record<string, string>;
    cause?: unknown;
    schemaIssues?: readonly StandardSchemaV1.Issue[];
    formData?: RequestFormDataPayload | FormData;
    retryAttempt?: number;
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
    this.schemaIssues = schemaIssues;
    this.cause = cause;
    this.response = response;
    this.url = url ?? '?';
    this.formData = formData;
    this.retryAttempt = retryAttempt;
  }

  toJSON(): {
    id: TypedFetchError['id'];
    message: string;
    headers: Record<string, string> | undefined;
    status: number;
    payload: RequestPayload | undefined;
    method: HttpMethod | undefined;
    errResponse: E | undefined;
    pathParams: RequestPathParams | undefined;
    jsonPathParams: Record<string, unknown> | undefined;
    schemaIssues: readonly StandardSchemaV1.Issue[] | undefined;
    response: unknown;
    retryAttempt: number | undefined;
  } {
    const { headers, formData, cause, ...rest } = this;

    const maskedHeaders: Record<string, string> = {};
    let hasHeaders = false;

    for (const [key, value] of Object.entries(headers ?? {})) {
      maskedHeaders[key] = maskHeaderValue(value);
      hasHeaders = true;
    }

    let causeToLog = cause;

    if (cause instanceof Error) {
      causeToLog = {
        name: cause.name,
        message: cause.message,
      };
    }

    return {
      ...rest,
      message: this.message,
      headers: hasHeaders ? maskedHeaders : undefined,
      cause: causeToLog,
    };
  }
}

function maskHeaderValue(value: string): string {
  const visible = Math.min(4, Math.ceil(value.length / 2));
  return value.slice(0, visible) + '*'.repeat(value.length - visible);
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
  startTimestamp: number,
  { indent = 0, hostAlias, logFn = defaultLogFn }: LogOptions = {},
) {
  function log(timestamp = 0, errorStatus: number | string = 0) {
    const logText = concatStrings(
      ' '.repeat(indent),
      !timestamp ?
        `${String(logId)}>>`
      : styleText(
          'bold',
          styleText(!errorStatus ? 'green' : 'red', `<<${String(logId)}`),
        ),
      ` api_call:${styleText('bold', method)} ${styleText(
        'gray',
        hostAlias ?? url.host,
      )}${url.pathname}`,
      !!errorStatus && styleText('red', ` ${errorStatus} `),
      !!timestamp && [
        ' ',
        styleText('gray', readableDuration(Date.now() - timestamp)),
      ],
    );

    logFn(logText, {
      startTimestamp: timestamp,
      errorStatus,
      logId,
      method,
      url,
    });
  }

  log();

  return {
    success: () => log(startTimestamp),
    error: (status: string | number) => log(startTimestamp, status),
  };
}

export function readableDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(2)}s`;
}
function getPathSegmentString(
  path: StandardSchemaV1.PathSegment | PropertyKey,
): string {
  const key = typeof path === 'object' ? path.key : path;
  if (typeof key === 'number') {
    return `[${key}]`;
  } else if (typeof key === 'symbol') {
    return `[symbol:${key.toString()}]`;
  } else {
    return String(key);
  }
}

function getValidationProps(issues: readonly StandardSchemaV1.Issue[]): Partial<
  Omit<TypedFetchError, 'message' | 'errResponse'>
> & {
  message: string;
} {
  return {
    message: issues
      .map((issue) =>
        issue.path ?
          `$.${issue.path
            .map(getPathSegmentString)
            .join('.')}: ${issue.message}`
        : issue.message,
      )
      .join('\n'),
    schemaIssues: issues,
  };
}

export function standardResultValidate<I, O = I>(
  schema: StandardSchemaV1<I, O>,
  input: unknown,
): Result<O, readonly StandardSchemaV1.Issue[]> {
  const result = schema['~standard'].validate(input);

  if (result instanceof Promise)
    return Result.err<StandardSchemaV1.Issue[]>([
      { message: 'Async validation not supported' },
    ]);

  if (result.issues) {
    return Result.err(result.issues);
  }

  return Result.ok(result.value);
}

const defaultFetcher: TypedFetchFetcher = async (url, options) => {
  const response = await fetch(url, options);

  return {
    getText: () => response.text(),
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
  };
};
