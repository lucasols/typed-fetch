import { concatStrings } from '@ls-stack/utils/stringUtils';
import { styleText } from 'node:util';
import { readableDuration, type TypedFetchLogger } from './main';

type LogOptions = {
  indent?: number;
  hostAlias?: string;
};

export function getNodeLogger({
  indent = 0,
  hostAlias,
}: LogOptions = {}): TypedFetchLogger {
  return (logId, url, method, startTimestamp) => {
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

      console.info(logText);
    }

    log();

    return {
      success: () => log(startTimestamp),
      error: (status: string | number) => log(startTimestamp, status),
    };
  };
}
