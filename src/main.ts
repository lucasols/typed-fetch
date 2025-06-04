import { cachedGetter } from '@ls-stack/utils/cache';
import { safeJsonStringify } from '@ls-stack/utils/safeJson';
import { type __LEGIT_ANY__ } from '@ls-stack/utils/saferTyping';
import { sleep } from '@ls-stack/utils/sleep';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Result, resultify } from 't-result';

type GlobalDefaults = {
  logger?: TypedFetchLogger;
  fetcher?: TypedFetchFetcher;
};

let globalDefaults: GlobalDefaults = {
  logger: undefined,
  fetcher: undefined,
};

let devLogId = 0;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type RequestPayload = Record<string, unknown> | unknown[];
export type RequestPathParams = Record<
  string,
  string | number | boolean | string[] | number[] | undefined
>;
export type RequestFormDataPayload = Record<
  string,
  string | File | File[] | RequestPayload | undefined
>;

type RequestHeaders = Record<string, string | null>;

type RequestOptions = {
  headers: Headers;
  method: HttpMethod;
  body: FormData | string | undefined;
  signal: AbortSignal | undefined;
};

export type TypedFetchFetcher = (
  url: URL,
  options: RequestOptions,
) => Promise<{
  getText: () => Promise<string>;
  status: number;
  statusText: string;
  ok: boolean;
  response: {
    headers: Headers;
    url: string;
    instance: Response | null;
  };
}>;

type LogOptions = {
  hostAlias?: string;
  indent?: number;
};

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
  headers?: Record<string, string | null>;
  /**
   * The JSON path params to be used in the request url
   */
  jsonPathParams?: Record<string, unknown>;
  /**
   * The form data to be sent in the request body, can be a FormData object or an {@link RequestFormDataPayload} object
   */
  formData?: RequestFormDataPayload | FormData;
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
    /**
     * The error ids to retry on
     *
     * @default ['request_error', 'network_or_cors_error']
     */
    retryOnErrIds?: TypedFetchError['id'][];
    /**
     * The delay between retries
     */
    delayMs: number | ((attempt: number) => number);
    condition?: (context: RetryContext<E>) => boolean;
    onRetry?: (context: RetryContext<E>) => void;
  };
  /**
   * Fetcher, the fetch implementation to use, it will use `fetch` by default
   */
  fetcher?: TypedFetchFetcher;
  /**
   * A function to validate the fetch final response
   */
  responseIsValid?: (response: {
    headers: Headers;
    url: string;
    response: Response | null;
  }) => Error | true;
  logger?: TypedFetchLogger;
  logOptions?: LogOptions;
  /**
   * A function to be called when the request starts, fetchOptions can be mutated
   * before the request is made
   */
  onRequest?: (
    url: URL,
    fetchOptions: RequestOptions,
    options: GenericApiCallParams,
    retryAttempt: number,
  ) => void;
  /**
   * A function to be called when the response is received, it will be called
   * with the response instance or null if the fetcher do not support it
   */
  onResponse?: (
    response: Response | null,
    fetchOptions: RequestOptions,
    options: GenericApiCallParams,
    retryAttempt: number,
  ) => void;
  /**
   * A function to be called when some error occurs
   */
  onError?: (
    error: TypedFetchError,
    fetchOptions: RequestOptions,
    options: GenericApiCallParams,
    retryAttempt: number,
  ) => void;
};

type GenericApiCallParams<E = unknown> = ApiCallParams<E> & {
  jsonResponse?: boolean;
  responseSchema?: StandardSchemaV1<unknown>;
  errorResponseSchema?: StandardSchemaV1<E>;
  getMessageFromRequestError?: (errorResponse: E) => string;
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
  options: GenericApiCallParams<__LEGIT_ANY__>,
): Promise<Result<unknown, TypedFetchError<unknown>>> {
  const {
    payload,
    responseSchema,
    method = 'GET',
    host,
    pathParams,
    headers,
    jsonPathParams,
    disablePathValidation,
    errorResponseSchema,
    getMessageFromRequestError,
    formData,
    timeoutMs,
    signal,
    jsonResponse = true,
    retry,
    fetcher = globalDefaults.fetcher ?? defaultFetcher,
    responseIsValid,
    logger = globalDefaults.logger,
    logOptions,
    onRequest,
    onResponse,
    onError,
  } = options;

  const startTimestamp = retry || logger ? Date.now() : undefined;

  const maxAttempts = retry?.[originalMaxRetries] ?? retry?.maxRetries ?? 0;

  const retryAttempt = maxAttempts - (retry?.maxRetries ?? 0);

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
    logger ?
      logger(++devLogId, url, method, startTimestamp ?? 0, logOptions)
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

  const finalHeaders: Headers = new Headers();

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== null) {
        finalHeaders.set(key, value);
      }
    }
  }

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
    finalHeaders.delete('Content-Type');
    finalHeaders.delete('content-type');
  } else if (payload) {
    body = safeJsonStringify(payload) ?? undefined;
    if (
      !finalHeaders.get('Content-Type') &&
      !finalHeaders.get('content-type')
    ) {
      finalHeaders.set('Content-Type', 'application/json');
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

  const fetchOptions: RequestOptions = {
    headers: finalHeaders,
    method,
    body,
    signal: abortSignal,
  };

  if (onRequest) {
    const onRequestResult = resultify(() =>
      onRequest(url, fetchOptions, options, retryAttempt),
    );

    if (!onRequestResult.ok) {
      return errorResult(
        new TypedFetchError({
          id: 'hook_cb_error',
          cause: onRequestResult.error,
          message: onRequestResult.error.message,
        }),
      );
    }
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

  if (responseIsValid) {
    const assertResult = resultify(() =>
      responseIsValid({
        headers: response.value.response.headers,
        url: response.value.response.url,
        response: response.value.response.instance,
      }),
    );

    const isValid =
      assertResult.error ? assertResult.error : assertResult.value;

    if (isValid !== true) {
      return errorResult(
        new TypedFetchError({
          id: 'invalid_response',
          cause: isValid,
          message: isValid.message,
          status: response.value.status,
          response: responseText.value,
        }),
      );
    }
  }

  if (onResponse) {
    const onResponseResult = resultify(() =>
      onResponse(
        response.value.response.instance,
        fetchOptions,
        options,
        retryAttempt,
      ),
    );

    if (!onResponseResult.ok) {
      console.error(onResponseResult.error);
    }
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

    const nextRetryAttempt = retryAttempt + 1;

    const newError = new TypedFetchError<unknown>({
      ...error,
      message: error.message,
      status: error.status || 0,
      errResponse: error.errResponse,
      ...getGenericErrorPayload(url),
      retryAttempt:
        maxAttempts === 0 || nextRetryAttempt === 1 ?
          undefined
        : nextRetryAttempt - 1,
    });

    newError.stack = error.stack;

    const canRetryErrorId = getCanRetryErrorId(error.id, retry?.retryOnErrIds);

    const errorDuration = cachedGetter(
      () => Date.now() - (startTimestamp ?? 0),
    );

    if (
      retry?.maxRetries &&
      retry.maxRetries > 0 &&
      canRetryErrorId &&
      (retry.condition?.({
        error,
        retryAttempt: nextRetryAttempt,
        errorDuration: errorDuration.value,
      }) ??
        true)
    ) {
      const delay =
        typeof retry.delayMs === 'function' ?
          retry.delayMs(nextRetryAttempt)
        : retry.delayMs;

      await sleep(delay);

      const onRetryResult = resultify(() =>
        retry.onRetry?.({
          error,
          retryAttempt: nextRetryAttempt,
          errorDuration: errorDuration.value,
        }),
      );

      if (!onRetryResult.ok) {
        console.error(onRetryResult.error);
      }

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

    if (onError) {
      const onErrorResult = resultify(() =>
        onError(newError, fetchOptions, options, retryAttempt),
      );

      if (!onErrorResult.ok) {
        console.error(onErrorResult.error);
      }
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
    | 'hook_cb_error'
    | 'invalid_json'
    | 'response_validation_error'
    | 'timeout'
    | 'invalid_response';
  readonly status: number;
  readonly payload: RequestPayload | undefined;
  readonly errResponse: E | undefined;
  readonly pathParams: RequestPathParams | undefined;
  readonly jsonPathParams: Record<string, unknown> | undefined;
  readonly method: HttpMethod | undefined;
  readonly schemaIssues: readonly StandardSchemaV1.Issue[] | undefined;
  readonly response: unknown;
  readonly url: string;
  readonly formData: RequestFormDataPayload | FormData | undefined;
  readonly retryAttempt: number | undefined;
  #rawHeaders: RequestHeaders | undefined;

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
    headers?: RequestHeaders;
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
    this.#rawHeaders = headers;
    this.schemaIssues = schemaIssues;
    this.cause = cause;
    this.response = response;
    this.url = url ?? '?';
    this.formData = formData;
    this.retryAttempt = retryAttempt;
  }

  get headers(): RequestHeaders | undefined {
    return getMaskedHeaders(this.#rawHeaders);
  }

  getUnmaskedHeaders(): RequestHeaders | undefined {
    return this.#rawHeaders;
  }

  toJSON(): {
    id: TypedFetchError['id'];
    message: string;
    headers: RequestHeaders | undefined;
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
    const { formData, cause, ...rest } = this;

    let causeToLog = cause;

    if (cause instanceof Error) {
      causeToLog = {
        name: cause.name,
        message: cause.message,
      };
    }

    return {
      ...rest,
      headers: this.headers,
      message: this.message,
      cause: causeToLog,
    };
  }
}

function getMaskedHeaders(
  headers: RequestHeaders | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;

  const maskedHeaders: Record<string, string> = {};
  let hasHeaders = false;

  for (const [key, value] of Object.entries(headers)) {
    if (value === null) continue;

    maskedHeaders[key] = maskHeaderValue(value);
    hasHeaders = true;
  }

  return hasHeaders ? maskedHeaders : undefined;
}

function getCanRetryErrorId(
  errorId: TypedFetchError['id'],
  retryOnErrIds: TypedFetchError['id'][] = [
    'request_error',
    'network_or_cors_error',
  ],
): boolean {
  return retryOnErrIds.includes(errorId);
}

function maskHeaderValue(value: string): string {
  const visible = Math.min(4, Math.ceil(value.length / 2));
  return value.slice(0, visible) + '*'.repeat(value.length - visible);
}

export type TypedFetchLogger = (
  logId: number,
  url: URL,
  method: string,
  startTimestamp: number,
  logOptions: LogOptions | undefined,
) => {
  success: () => void;
  error: (status: string | number) => void;
};

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
    response: {
      headers: response.headers,
      url: response.url,
      instance: response,
    },
  };
};

export function setTypedFetchGlobalDefaults(defaults: Partial<GlobalDefaults>) {
  globalDefaults = { ...globalDefaults, ...defaults };
}
