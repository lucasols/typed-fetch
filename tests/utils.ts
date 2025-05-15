import fetchMock from 'fetch-mock';
import type { Result } from 't-result';
import { TypedFetchError } from '../src/main';

export function getErrorObj(obj: TypedFetchError) {
  const errorObj = obj.toJSON();

  return Object.fromEntries(
    Object.entries(errorObj).filter(([, value]) => value !== undefined),
  );
}

export function getSuccessValueFromResult<T>(
  result: Result<T, TypedFetchError>,
) {
  if (!result.ok) {
    throw new Error(
      `Result should be ok, but it is an error: [${result.error.name}: ${result.error.message}]`,
      {
        cause: result.error,
      },
    );
  }

  return result.value;
}

export function getErrorObjFromResult(result: Result<any, TypedFetchError>) {
  if (result.ok) {
    throw new Error('Result should be an error, but it is ok');
  }

  if (!(result.error instanceof TypedFetchError)) {
    throw new Error('Result should be a TypedFetchError');
  }

  return getErrorObj(result.error);
}

export function getLastCall({
  includeBody = false,
}: { includeBody?: boolean } = {}) {
  const lastCall = fetchMock.callHistory.lastCall();
  if (!lastCall) {
    throw new Error('No response found');
  }

  return [
    lastCall.url,
    {
      headers: lastCall.options.headers,
      method: lastCall.options.method?.toLocaleUpperCase() ?? 'GET',
      ...(includeBody && { body: lastCall.options.body }),
    },
  ] as const;
}
