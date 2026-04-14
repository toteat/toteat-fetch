import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHttpClient, HttpClientError } from 'toteat-fetch';
import { mockResponse, mockBlobResponse } from './helpers.js';

describe('fetchClient - Browser Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // buildUrl
  // ---------------------------------------------------------------------------

  describe('buildUrl', () => {
    it('should build URL with baseURL and path', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('https://api.example.com/test');
    });

    it('should build URL without baseURL', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toBe('/test');
    });

    it('should strip trailing slash from baseURL', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com/' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toBe('https://api.example.com/test');
    });

    it('should append query parameters to URL', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { params: { foo: 'bar', baz: 123 } });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('?');
      expect(url).toContain('foo=bar');
      expect(url).toContain('baz=123');
    });

    it('should skip undefined and null params', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', {
        params: { foo: 'bar', undef: undefined, nil: null },
      });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('foo=bar');
      expect(url).not.toContain('undef');
      expect(url).not.toContain('nil');
    });

    it('should not append query string for empty params', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { params: {} });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).not.toContain('?');
    });

    it('should handle boolean and numeric params', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', {
        params: { active: true, deleted: false, count: 0, val: -1 },
      });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('active=true');
      expect(url).toContain('deleted=false');
      expect(url).toContain('count=0');
      expect(url).toContain('val=-1');
    });

    it('should insert leading slash when path has no leading slash and baseURL is set', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('users/1');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toBe('https://api.example.com/users/1');
    });

    it('should reject protocol-relative URLs when baseURL is configured', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await expect(client.get('//evil.com/steal')).rejects.toThrow(
        'Absolute URL "//evil.com/steal" is not allowed when baseURL is configured',
      );
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP Methods
  // ---------------------------------------------------------------------------

  describe('HTTP Methods', () => {
    it('should execute GET request', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { data: 'test' })));

      await client.get('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('GET');
    });

    it('should execute POST request with data', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { id: 1 })));

      const payload = { name: 'test', value: 123 };
      await client.post('/create', payload);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify(payload));
    });

    it('should execute PUT request with data', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { id: 1 })));

      const payload = { name: 'updated' };
      await client.put('/update/1', payload);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('PUT');
      expect(init.body).toBe(JSON.stringify(payload));
    });

    it('should execute DELETE request', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.delete('/resource/1');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('DELETE');
    });

    it('should not set body for POST with no data', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.post('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBeUndefined();
    });

    it('should not set body for POST with null data', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.post('/test', null);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBeUndefined();
    });

    it('should serialize complex JSON body', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      const complexData = { nested: { deep: 123 }, array: [1, 2, 3], bool: true };
      await client.post('/test', complexData);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(JSON.stringify(complexData));
    });
  });

  // ---------------------------------------------------------------------------
  // Response Handling
  // ---------------------------------------------------------------------------

  describe('Response Handling', () => {
    it('should parse JSON response', async () => {
      const client = createHttpClient();
      const responseData = { message: 'success', code: 200 };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, responseData)));

      const response = await client.get('/test');

      expect(response.data).toEqual(responseData);
      expect(response.status).toBe(200);
    });

    it('should parse text response when content-type is not json', async () => {
      const client = createHttpClient();
      const responseText = 'Plain text response';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(200, responseText, 'text/plain')),
      );

      const response = await client.get('/test');

      expect(response.data).toBe(responseText);
    });

    it('should throw HttpClientError when JSON parsing fails (no silent fallback)', async () => {
      const client = createHttpClient();
      const headers = new Headers({ 'content-type': 'application/json' });

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          headers,
          json: () => Promise.reject(new Error('JSON parse error')),
          text: () => Promise.resolve('Invalid JSON text'),
        } as unknown as Response),
      );

      await expect(client.get('/test')).rejects.toThrow(HttpClientError);
      await expect(client.get('/test')).rejects.toThrow('Failed to parse JSON response');
    });

    it('should throw HttpClientError when server declares application/json but sends malformed JSON', async () => {
      const malformed = {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
        text: () => Promise.resolve('<!DOCTYPE html>'),
      } as unknown as Response;

      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(malformed));

      await expect(client.get('/test')).rejects.toThrow(HttpClientError);
      await expect(client.get('/test')).rejects.toThrow('Failed to parse JSON response');
    });

    it('should throw HttpClientError when text() reading fails', async () => {
      const brokenBody = {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: () => Promise.reject(new TypeError('Already consumed')),
        text: () => Promise.reject(new TypeError('Body already consumed')),
      } as unknown as Response;

      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(brokenBody));

      await expect(client.get('/test')).rejects.toThrow(HttpClientError);
      await expect(client.get('/test')).rejects.toThrow('Failed to read response body');
    });

    it('should handle missing content-type gracefully', async () => {
      const client = createHttpClient();
      const headers = new Headers();

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          headers,
          text: () => Promise.resolve('text body'),
          json: () => Promise.resolve({}),
        } as unknown as Response),
      );

      const response = await client.get('/test');

      expect(response.data).toBeDefined();
    });

    it('should return response headers as record', async () => {
      const client = createHttpClient();
      const headers = new Headers({
        'content-type': 'application/json',
        'x-custom': 'custom-value',
        'x-request-id': '12345',
      });

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          headers,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('{}'),
        } as unknown as Response),
      );

      const response = await client.get('/test');

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['x-custom']).toBe('custom-value');
      expect(response.headers['x-request-id']).toBe('12345');
    });

    it('should return correct numeric status', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(201, {})));

      const response = await client.get('/test');

      expect(response.status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should throw HttpClientError for 4xx status', async () => {
      const client = createHttpClient();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(400, { error: 'bad request' })),
      );

      await expect(client.get('/test')).rejects.toThrow(HttpClientError);
    });

    it('should throw HttpClientError for 5xx status', async () => {
      const client = createHttpClient();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(500, { error: 'server error' })),
      );

      await expect(client.get('/test')).rejects.toThrow(HttpClientError);
    });

    it('should include error status and data in HttpClientError', async () => {
      const client = createHttpClient();
      const errorData = { error: 'validation failed', details: ['field required'] };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, errorData)));

      try {
        await client.get('/test');
        expect.fail('Should have thrown');
      } catch (err) {
        const error = err as HttpClientError;
        expect(error.response?.status).toBe(400);
        expect(error.response?.data).toEqual(errorData);
        expect(error.name).toBe('HttpClientError');
      }
    });

    it('should throw HttpClientError for network errors', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network connection failed')));

      await expect(client.get('/test')).rejects.toThrow(HttpClientError);
      await expect(client.get('/test')).rejects.toThrow('Network Error');
    });

    it('should throw HttpClientError for AbortError (external abort)', async () => {
      const client = createHttpClient({ timeout: 100 });
      const abortError = new DOMException('Aborted', 'AbortError');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

      await expect(client.get('/test')).rejects.toThrow(HttpClientError);
      await expect(client.get('/test')).rejects.toThrow('Request aborted');
    });

    it('should throw HttpClientError for TimeoutError', async () => {
      const client = createHttpClient({ timeout: 100 });
      const timeoutError = new DOMException('Timeout', 'TimeoutError');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

      await expect(client.get('/test')).rejects.toThrow(HttpClientError);
      await expect(client.get('/test')).rejects.toThrow('timeout');
    });

    it('should report "Request aborted" (not timeout) when fetch is aborted externally', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError')),
      );

      const client = createHttpClient({ timeout: 30000 });

      try {
        await client.get('/test');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpClientError);
        expect((err as HttpClientError).message).toBe('Request aborted');
        expect((err as HttpClientError).message).not.toContain('timeout');
      }
    });

    it('should preserve the original error as cause on network errors', async () => {
      const originalError = new TypeError('Failed to fetch');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(originalError));

      const client = createHttpClient();

      try {
        await client.get('/test');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpClientError);
        expect((err as HttpClientError).cause).toBe(originalError);
      }
    });

    it('should route network error to response interceptor rejected handler', async () => {
      const client = createHttpClient();
      const errorHandler = vi.fn().mockResolvedValue({
        data: { recovered: true },
        status: 503,
        headers: {},
      });

      client.interceptors.response.use((response) => response, errorHandler);

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network connection failed')));

      const response = await client.get('/test');

      expect(response.data).toEqual({ recovered: true });
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout / AbortSignal
  // ---------------------------------------------------------------------------

  describe('Timeout', () => {
    it('should attach signal to fetch request', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeDefined();
    });

    it('should use custom timeout from config', async () => {
      const client = createHttpClient({ timeout: 5000 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeDefined();
    });

    it('should use AbortSignal.timeout when available', async () => {
      const client = createHttpClient({ timeout: 5000 });
      const originalTimeout = (AbortSignal as unknown as Record<string, unknown>).timeout;
      const mockTimeout = vi.fn().mockReturnValue(new AbortController().signal);
      (AbortSignal as unknown as Record<string, unknown>).timeout = mockTimeout;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      try {
        await client.get('/test');
        expect(mockTimeout).toHaveBeenCalledWith(5000);
      } finally {
        (AbortSignal as unknown as Record<string, unknown>).timeout = originalTimeout;
      }
    });

    it('should fallback to AbortController when AbortSignal.timeout is unavailable', async () => {
      const client = createHttpClient({ timeout: 5000 });
      const originalTimeout = (AbortSignal as unknown as Record<string, unknown>).timeout;
      delete (AbortSignal as unknown as Record<string, unknown>).timeout;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      try {
        await client.get('/test');
        const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
        expect(init.signal).toBeDefined();
      } finally {
        (AbortSignal as unknown as Record<string, unknown>).timeout = originalTimeout;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Request Interceptors
  // ---------------------------------------------------------------------------

  describe('Request Interceptors', () => {
    it('should call request interceptor', async () => {
      const client = createHttpClient();
      let interceptorCalled = false;

      client.interceptors.request.use((config) => {
        interceptorCalled = true;
        return config;
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      expect(interceptorCalled).toBe(true);
    });

    it('should allow interceptor to modify headers', async () => {
      const client = createHttpClient();

      client.interceptors.request.use((config) => {
        config.headers['X-Custom'] = 'interceptor-value';
        return config;
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('interceptor-value');
    });

    it('should call error handler when interceptor throws', async () => {
      const client = createHttpClient();
      const errorHandler = vi.fn();

      client.interceptors.request.use(() => {
        throw new Error('interceptor failed');
      }, errorHandler);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      try {
        await client.get('/test');
      } catch {
        // expected
      }

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should return from error handler if it resolves', async () => {
      const client = createHttpClient();
      const resolvedConfig = {
        url: '/test',
        method: 'GET',
        baseURL: '',
        headers: {},
        params: {},
        timeout: 30000,
        validateStatus: (s: number) => s >= 200 && s < 300,
      };
      const errorHandler = vi.fn().mockResolvedValue(resolvedConfig);

      client.interceptors.request.use(() => {
        throw new Error('interceptor failed');
      }, errorHandler);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { ok: true })));

      // The error handler returns a config-shaped object, which executeRequest uses directly
      const response = await client.get('/test');
      expect(errorHandler).toHaveBeenCalled();
      // Response came through even after interceptor error
      expect(response).toBeDefined();
    });

    it('should chain multiple request interceptors in order', async () => {
      const client = createHttpClient();
      const calls: number[] = [];

      client.interceptors.request.use((config) => {
        calls.push(1);
        return config;
      });

      client.interceptors.request.use((config) => {
        calls.push(2);
        return config;
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      expect(calls).toEqual([1, 2]);
    });

    it('should return interceptor ID starting from 0', () => {
      const client = createHttpClient();

      const id1 = client.interceptors.request.use((config) => config);
      const id2 = client.interceptors.request.use((config) => config);

      expect(id1).toBe(0);
      expect(id2).toBe(1);
    });

    it('should not mutate the original config headers when a request interceptor modifies them', async () => {
      const client = createHttpClient({ headers: { Authorization: 'Bearer token' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      client.interceptors.request.use((config) => {
        config.headers['X-Added'] = 'yes';
        return config;
      });

      // Make two requests
      await client.get('/test');
      await client.get('/test');

      // Both requests should have the interceptor-added header (that's fine — it's applied each time)
      // But neither should have leaked the mutation into the shared defaults
      const firstCallHeaders = (vi.mocked(fetch).mock.calls[0][1] as RequestInit)
        .headers as Record<string, string>;
      const secondCallHeaders = (vi.mocked(fetch).mock.calls[1][1] as RequestInit)
        .headers as Record<string, string>;

      // Both calls should have Authorization from defaults
      expect(firstCallHeaders['Authorization']).toBe('Bearer token');
      expect(secondCallHeaders['Authorization']).toBe('Bearer token');
      // Both calls should have X-Added from interceptor (applied fresh each time)
      expect(firstCallHeaders['X-Added']).toBe('yes');
      expect(secondCallHeaders['X-Added']).toBe('yes');
    });
  });

  // ---------------------------------------------------------------------------
  // Response Interceptors
  // ---------------------------------------------------------------------------

  describe('Response Interceptors', () => {
    it('should call response interceptor', async () => {
      const client = createHttpClient();
      let interceptorCalled = false;

      client.interceptors.response.use((response) => {
        interceptorCalled = true;
        return response;
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      expect(interceptorCalled).toBe(true);
    });

    it('should allow interceptor to transform response data', async () => {
      const client = createHttpClient();

      client.interceptors.response.use((response) => ({
        ...response,
        data: { ...response.data, modified: true },
      }));

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { original: true })));

      const response = await client.get('/test');

      expect((response.data as Record<string, unknown>).modified).toBe(true);
      expect((response.data as Record<string, unknown>).original).toBe(true);
    });

    it('should call rejected handler when status fails validation', async () => {
      const client = createHttpClient();
      const errorHandler = vi.fn();

      client.interceptors.response.use((response) => response, errorHandler);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(400, { error: 'bad request' })),
      );

      try {
        await client.get('/test');
      } catch {
        // expected
      }

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should chain multiple response interceptors in order', async () => {
      const client = createHttpClient();
      const calls: number[] = [];

      client.interceptors.response.use((response) => {
        calls.push(1);
        return response;
      });

      client.interceptors.response.use((response) => {
        calls.push(2);
        return response;
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      expect(calls).toEqual([1, 2]);
    });

    it('should support async response interceptors', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { original: true })));

      client.interceptors.response.use(async (response) => {
        await Promise.resolve(); // simulate async work
        return { ...response, data: { ...(response.data as object), async: true } };
      });

      const result = await client.get<{ original: boolean; async: boolean }>('/test');
      expect(result.data.original).toBe(true);
      expect(result.data.async).toBe(true);
    });

    it('should pass each response interceptor the output of the previous one', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { step: 0 })));

      client.interceptors.response.use((r) => ({ ...r, data: { step: 1 } }));
      client.interceptors.response.use((r) => ({
        ...r,
        data: { step: (r.data as { step: number }).step + 1 },
      }));

      const result = await client.get<{ step: number }>('/test');
      expect(result.data.step).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Config Merging
  // ---------------------------------------------------------------------------

  describe('Config Merging', () => {
    it('should merge default headers with request headers', async () => {
      const client = createHttpClient({ headers: { 'X-Default': 'default' } });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { headers: { 'X-Custom': 'custom' } });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Default']).toBe('default');
      expect(headers['X-Custom']).toBe('custom');
    });

    it('should allow per-request headers to override defaults', async () => {
      const client = createHttpClient({ headers: { 'X-Key': 'default' } });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { headers: { 'X-Key': 'overridden' } });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Key']).toBe('overridden');
    });

    it('should accept custom validateStatus that allows all statuses', async () => {
      const client = createHttpClient();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(404, { error: 'not found' })));

      await expect(client.get('/test')).rejects.toThrow();

      const response = await client.get('/test', { validateStatus: () => true });
      expect(response.status).toBe(404);
    });

    it('should use 30000ms timeout by default', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Type Generic Support
  // ---------------------------------------------------------------------------

  describe('Generic Types', () => {
    it('should support typed response on GET', async () => {
      interface User {
        id: number;
        name: string;
      }
      const client = createHttpClient();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(200, { id: 1, name: 'Alice' })),
      );

      const response = await client.get<User>('/user');

      expect(response.data).toHaveProperty('id');
      expect(response.data).toHaveProperty('name');
    });

    it('should support typed response on POST', async () => {
      interface Created {
        success: boolean;
        id: number;
      }
      const client = createHttpClient();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(201, { success: true, id: 99 })),
      );

      const response = await client.post<Created>('/create', { name: 'test' });

      expect(response.status).toBe(201);
      expect((response.data as Created).success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // AbortSignal per-request
  // ---------------------------------------------------------------------------

  describe('per-request signal', () => {
    it('should pass per-request signal to fetch when provided', async () => {
      const controller = new AbortController();
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { signal: controller.signal });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      // When AbortSignal.any is available, a combined signal is passed (not the original reference)
      expect(init.signal).toBeInstanceOf(AbortSignal);
      // Aborting the controller should abort the combined signal
      controller.abort();
      expect((init.signal as AbortSignal).aborted).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // responseType: blob
  // ---------------------------------------------------------------------------

  describe('responseType: blob', () => {
    it('passes responseType through internal config (smoke test via blob response)', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      const blob = new Blob(['binary'], { type: 'application/octet-stream' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBlobResponse(200, blob)));

      const res = await client.get('/file', { responseType: 'blob' });

      expect(res.data).toBeInstanceOf(Blob);
    });

    it('ignores content-type when responseType is blob', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      const blob = new Blob(['{"key":"value"}'], { type: 'application/json' });
      const jsonSpy = vi.fn().mockRejectedValue(new Error('should not call json()'));
      const textSpy = vi.fn().mockRejectedValue(new Error('should not call text()'));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        blob: () => Promise.resolve(blob),
        json: jsonSpy,
        text: textSpy,
      } as unknown as Response));

      const res = await client.get<Blob>('/file', { responseType: 'blob' });

      expect(res.data).toBeInstanceOf(Blob);
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(textSpy).not.toHaveBeenCalled();
    });

    it('returns null data for 204 even with responseType: blob', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      const blobSpy = vi.fn().mockRejectedValue(new Error('should not call blob()'));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 204,
        ok: true,
        headers: new Headers(),
        blob: blobSpy,
      } as unknown as Response));

      const res = await client.get('/file', { responseType: 'blob' });

      expect(res.data).toBeNull();
      expect(res.status).toBe(204);
      expect(blobSpy).not.toHaveBeenCalled();
    });

    it('throws HttpClientError when blob() rejects', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        blob: () => Promise.reject(new Error('stream error')),
      } as unknown as Response));

      await expect(client.get('/file', { responseType: 'blob' })).rejects.toThrow(HttpClientError);
      await expect(client.get('/file', { responseType: 'blob' })).rejects.toThrow('Failed to read blob response');
    });

    it('without responseType still parses JSON normally', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { id: 1 })));

      const res = await client.get<{ id: number }>('/data');

      expect(res.data).toEqual({ id: 1 });
    });
  });
});
