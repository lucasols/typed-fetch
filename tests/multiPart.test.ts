import { assert, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { typedFetch } from '../src/main';

// Mock the global fetch function
global.fetch = vi.fn();

const mockFetch = vi.mocked<
  (url: URL, options?: RequestInit) => Promise<Response>
>(global.fetch);

function successResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFetch.mockImplementation(() => successResponse({ message: 'Success' }));
});

describe('multipart/form-data requests', () => {
  test('should send basic string data', async () => {
    const result = await typedFetch('upload', {
      method: 'POST',
      host: 'http://localhost:3000',
      multiPart: {
        field1: 'value1',
        field2: 'value2',
      },
      responseSchema: z.object({ message: z.string() }),
    });

    assert(result.ok);
    expect(result.value).toEqual({ message: 'Success' });

    const lastCall = mockFetch.mock.lastCall;
    expect(lastCall?.[0].toString()).toBe('http://localhost:3000/upload');
    expect(lastCall?.[1]?.method).toBe('POST');
    expect(lastCall?.[1]?.headers).toEqual({}); // Content-Type should be unset
    expect(lastCall?.[1]?.body).toBeInstanceOf(FormData);

    const formData = lastCall?.[1]?.body as FormData;
    expect(formData.get('field1')).toBe('value1');
    expect(formData.get('field2')).toBe('value2');
  });

  test('should send a File object', async () => {
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });

    await typedFetch('upload/file', {
      method: 'POST',
      host: 'http://localhost:3000',
      multiPart: {
        textFile: file,
        description: 'A text file',
      },
    });

    const lastCall = mockFetch.mock.lastCall;
    expect(lastCall?.[1]?.body).toBeInstanceOf(FormData);
    const formData = lastCall?.[1]?.body as FormData;
    expect(formData.get('description')).toBe('A text file');
    expect(formData.get('textFile')).toBeInstanceOf(File);
    const sentFile = formData.get('textFile') as File;
    expect(sentFile.name).toBe('test.txt');
    expect(sentFile.type).toBe('text/plain');
  });

  test('should send an array of File objects', async () => {
    const file1 = new File(['content1'], 'file1.txt', { type: 'text/plain' });
    const file2 = new File(['content2'], 'file2.txt', { type: 'text/csv' });

    await typedFetch('upload/files', {
      method: 'PUT',
      host: 'http://localhost:3000',
      multiPart: {
        textFiles: [file1, file2],
        userId: 'user123',
      },
    });

    const lastCall = mockFetch.mock.lastCall;
    expect(lastCall?.[1]?.body).toBeInstanceOf(FormData);
    const formData = lastCall?.[1]?.body as FormData;
    expect(formData.get('userId')).toBe('user123');
    const files = formData.getAll('textFiles');
    expect(files).toHaveLength(2);
    expect(files[0]).toBeInstanceOf(File);
    expect((files[0] as File).name).toBe('file1.txt');
    expect((files[1] as File).name).toBe('file2.txt');
  });

  test('should send a JSON object stringified', async () => {
    const jsonData = { id: 1, config: { enabled: true } };

    await typedFetch('upload/json', {
      method: 'POST',
      host: 'http://localhost:3000',
      multiPart: {
        jsonData,
        metadata: 'some info',
      },
    });

    const lastCall = mockFetch.mock.lastCall;
    expect(lastCall?.[1]?.body).toBeInstanceOf(FormData);
    const formData = lastCall?.[1]?.body as FormData;
    expect(formData.get('metadata')).toBe('some info');
    expect(formData.get('jsonData')).toBe(JSON.stringify(jsonData));
  });

  test('should return error if both payload and multiPart are provided', async () => {
    const result = await typedFetch('upload', {
      method: 'POST',
      host: 'http://localhost:3000',
      payload: { key: 'value' },
      multiPart: { field: 'data' },
    });

    assert(!result.ok);
    expect(result.error.id).toBe('invalid_payload');
    expect(result.error.message).toBe('Cannot use both payload and multiPart');
  });

  test('should return error if multiPart is used with GET', async () => {
    const result = await typedFetch('upload', {
      method: 'GET',
      host: 'http://localhost:3000',
      multiPart: { field: 'data' },
    });

    assert(!result.ok);
    expect(result.error.id).toBe('invalid_payload');
    expect(result.error.message).toContain('not allowed for GET');
    expect(result.error.multiPart).toEqual({ field: 'data' });
  });
});
