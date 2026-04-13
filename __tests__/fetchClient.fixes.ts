import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHttpClient, HttpClientError } from 'toteat-fetch';

function mockResponse(status: number, data: unknown, contentType = 'application/json'): Response {
  const responseHeaders = new Headers({ 'content-type': contentType });
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: responseHeaders,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

function mock204Response(): Response {
  return {
    status: 204,
    ok: true,
    headers: new Headers(),
    json: () => Promise.reject(new Error('No body')),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

describe('Audit Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // #1 Critical: Content-Type: application/json auto-set
  // ---------------------------------------------------------------------------

  describe('#1 Content-Type auto-set', () => {
    it('should auto-set Content-Type: application/json on POST with object body', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.post('/test', { key: 'value' });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should auto-set Content-Type: application/json on PUT with object body', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.put('/test', { key: 'value' });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should auto-set Content-Type: application/json on PATCH', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.patch('/test', { key: 'value' });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should not override explicit Content-Type header', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.post('/test', { key: 'value' }, {
        headers: { 'Content-Type': 'text/plain' },
      });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('text/plain');
    });

    it('should not override lowercase content-type header', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.post('/test', { key: 'value' }, {
        headers: { 'content-type': 'text/xml' },
      });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['content-type']).toBe('text/xml');
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('should not set Content-Type when no body', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.post('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // #2 Critical: Request interceptor error handler returns config, not response
  // ---------------------------------------------------------------------------

  describe('#2 Request interceptor error recovery', () => {
    it('should continue request chain when error handler returns recovered config', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { ok: true })));

      client.interceptors.request.use(
        () => {
          throw new Error('token expired');
        },
        () => ({
          url: '/test',
          method: 'GET',
          baseURL: '',
          headers: { 'Authorization': 'Bearer refreshed-token' },
          params: {},
          timeout: 30000,
          validateStatus: (s: number) => s >= 200 && s < 300,
        }),
      );

      const response = await client.get('/test');

      // Fetch should actually have been called (not short-circuited)
      expect(vi.mocked(fetch)).toHaveBeenCalled();
      expect(response.data).toEqual({ ok: true });

      // The recovered config's headers should have been used
      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer refreshed-token');
    });

    it('should support async request interceptor error handlers', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { ok: true })));

      client.interceptors.request.use(
        () => {
          throw new Error('token expired');
        },
        async () => {
          await Promise.resolve(); // simulate async token refresh
          return {
            url: '/test',
            method: 'GET',
            baseURL: '',
            headers: {},
            params: {},
            timeout: 30000,
            validateStatus: (s: number) => s >= 200 && s < 300,
          };
        },
      );

      const response = await client.get('/test');
      expect(vi.mocked(fetch)).toHaveBeenCalled();
      expect(response.data).toEqual({ ok: true });
    });
  });

  // ---------------------------------------------------------------------------
  // #3 High: Array query params
  // ---------------------------------------------------------------------------

  describe('#3 Array query params', () => {
    it('should produce repeated keys for array params', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { params: { ids: [1, 2, 3] } });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('ids=1');
      expect(url).toContain('ids=2');
      expect(url).toContain('ids=3');
      // Should NOT contain comma-joined form
      expect(url).not.toContain('1%2C2%2C3');
      expect(url).not.toContain('1,2,3');
    });

    it('should skip null/undefined items within arrays', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { params: { ids: [1, null, undefined, 3] } });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('ids=1');
      expect(url).toContain('ids=3');
      expect(url).not.toContain('null');
      expect(url).not.toContain('undefined');
    });

    it('should handle empty array params', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { params: { ids: [], name: 'foo' } });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('name=foo');
      expect(url).not.toContain('ids');
    });
  });

  // ---------------------------------------------------------------------------
  // #4 High: AbortController fallback timer cleanup
  // ---------------------------------------------------------------------------

  describe('#4 Timer cleanup', () => {
    it('should clear fallback timeout after successful request', async () => {
      const client = createHttpClient({ timeout: 5000 });
      const originalTimeout = (AbortSignal as unknown as Record<string, unknown>).timeout;
      delete (AbortSignal as unknown as Record<string, unknown>).timeout;

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      try {
        await client.get('/test');
        expect(clearTimeoutSpy).toHaveBeenCalled();
      } finally {
        (AbortSignal as unknown as Record<string, unknown>).timeout = originalTimeout;
        clearTimeoutSpy.mockRestore();
      }
    });

    it('should clear fallback timeout on network error', async () => {
      const client = createHttpClient({ timeout: 5000 });
      const originalTimeout = (AbortSignal as unknown as Record<string, unknown>).timeout;
      delete (AbortSignal as unknown as Record<string, unknown>).timeout;

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      try {
        await client.get('/test');
      } catch {
        // expected
      }

      try {
        expect(clearTimeoutSpy).toHaveBeenCalled();
      } finally {
        (AbortSignal as unknown as Record<string, unknown>).timeout = originalTimeout;
        clearTimeoutSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // #5 High: Chain response error interceptors
  // ---------------------------------------------------------------------------

  describe('#5 Response error interceptor chaining', () => {
    it('should call multiple error interceptors when first re-throws', async () => {
      const client = createHttpClient();
      const calls: number[] = [];

      client.interceptors.response.use(
        (r) => r,
        (err) => {
          calls.push(1);
          throw err; // re-throw to next interceptor
        },
      );

      client.interceptors.response.use(
        (r) => r,
        (err) => {
          calls.push(2);
          throw err;
        },
      );

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, { error: 'bad' })));

      await expect(client.get('/test')).rejects.toThrow();
      expect(calls).toEqual([1, 2]);
    });

    it('should recover from second error interceptor', async () => {
      const client = createHttpClient();

      client.interceptors.response.use(
        (r) => r,
        (err) => {
          throw err; // re-throw
        },
      );

      client.interceptors.response.use(
        (r) => r,
        () => Promise.resolve({ data: { recovered: true }, status: 200, headers: {} }),
      );

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(500, { error: 'fail' })));

      const response = await client.get('/test');
      expect(response.data).toEqual({ recovered: true });
    });

    it('should chain network error through multiple interceptors', async () => {
      const client = createHttpClient();
      const calls: number[] = [];

      client.interceptors.response.use(
        (r) => r,
        (err) => {
          calls.push(1);
          throw err;
        },
      );

      client.interceptors.response.use(
        (r) => r,
        () => {
          calls.push(2);
          return Promise.resolve({ data: { fallback: true }, status: 503, headers: {} });
        },
      );

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      const response = await client.get('/test');
      expect(calls).toEqual([1, 2]);
      expect(response.data).toEqual({ fallback: true });
    });
  });

  // ---------------------------------------------------------------------------
  // #6 High: FormData/Blob body support
  // ---------------------------------------------------------------------------

  describe('#6 FormData/Blob body passthrough', () => {
    it('should pass FormData body through without JSON.stringify', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      const formData = new FormData();
      formData.append('file', new Blob(['hello']), 'test.txt');

      await client.post('/upload', formData);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(formData);
      // Should NOT set Content-Type (browser sets multipart boundary)
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('should pass Blob body through without JSON.stringify', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      const blob = new Blob(['data'], { type: 'application/octet-stream' });
      await client.post('/upload', blob);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(blob);
    });

    it('should pass ArrayBuffer body through', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      const buffer = new ArrayBuffer(8);
      await client.put('/upload', buffer);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(buffer);
    });

    it('should pass URLSearchParams body through', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      const params = new URLSearchParams({ key: 'value' });
      await client.post('/form', params);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(params);
    });
  });

  // ---------------------------------------------------------------------------
  // #7 Medium: HttpClientError.response includes headers
  // ---------------------------------------------------------------------------

  describe('#7 Error response includes headers', () => {
    it('should include response headers in HttpClientError', async () => {
      const client = createHttpClient();
      const responseHeaders = new Headers({
        'content-type': 'application/json',
        'x-request-id': 'abc-123',
      });

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 422,
          ok: false,
          headers: responseHeaders,
          json: () => Promise.resolve({ error: 'validation' }),
          text: () => Promise.resolve('{}'),
        } as unknown as Response),
      );

      try {
        await client.get('/test');
        expect.fail('Should have thrown');
      } catch (err) {
        const error = err as HttpClientError;
        expect(error.response?.headers).toBeDefined();
        expect(error.response?.headers['x-request-id']).toBe('abc-123');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // #8 Medium: 204 No Content
  // ---------------------------------------------------------------------------

  describe('#8 204 No Content handling', () => {
    it('should return null data for 204 response', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mock204Response()));

      const response = await client.delete('/resource/1');

      expect(response.status).toBe(204);
      expect(response.data).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // #9 Medium: URL with existing query string
  // ---------------------------------------------------------------------------

  describe('#9 URL with existing query string', () => {
    it('should append with & when URL already has query string', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/search?q=existing', { params: { page: 2 } });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toBe('/search?q=existing&page=2');
      // Must NOT have double ?
      expect(url.match(/\?/g)?.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // #10 Medium: Async request interceptors
  // ---------------------------------------------------------------------------

  describe('#10 Async request interceptors', () => {
    it('should await async request interceptor', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      client.interceptors.request.use(async (config) => {
        await Promise.resolve(); // simulate async work
        config.headers['Authorization'] = 'Bearer async-token';
        return config;
      });

      await client.get('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer async-token');
    });
  });

  // ---------------------------------------------------------------------------
  // #11 Medium: Interceptor eject
  // ---------------------------------------------------------------------------

  describe('#11 Interceptor eject', () => {
    it('should remove request interceptor via eject', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      let called = false;
      const id = client.interceptors.request.use((config) => {
        called = true;
        return config;
      });

      client.interceptors.request.eject(id);
      await client.get('/test');

      expect(called).toBe(false);
    });

    it('should remove response interceptor via eject', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      let called = false;
      const id = client.interceptors.response.use((response) => {
        called = true;
        return response;
      });

      client.interceptors.response.eject(id);
      await client.get('/test');

      expect(called).toBe(false);
    });

    it('should not affect other interceptors when ejecting one', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      const calls: number[] = [];
      client.interceptors.request.use((config) => {
        calls.push(1);
        return config;
      });
      const id2 = client.interceptors.request.use((config) => {
        calls.push(2);
        return config;
      });
      client.interceptors.request.use((config) => {
        calls.push(3);
        return config;
      });

      client.interceptors.request.eject(id2);
      await client.get('/test');

      expect(calls).toEqual([1, 3]);
    });
  });

  // ---------------------------------------------------------------------------
  // #12 Security: Absolute URL rejection when baseURL set
  // ---------------------------------------------------------------------------

  describe('#12 Absolute URL rejection', () => {
    it('should throw when path is absolute URL and baseURL is configured', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await expect(client.get('https://evil.com/steal')).rejects.toThrow(
        'Absolute URL',
      );
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('should allow absolute URL when no baseURL is configured', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('https://api.example.com/test');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toBe('https://api.example.com/test');
    });
  });

  // ---------------------------------------------------------------------------
  // #13 Security: CRLF header injection prevention
  // ---------------------------------------------------------------------------

  describe('#13 CRLF header injection prevention', () => {
    it('should reject header values containing \\r\\n', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await expect(
        client.get('/test', {
          headers: { 'X-Custom': 'value\r\nInjected: header' },
        }),
      ).rejects.toThrow('Invalid header');
    });

    it('should reject header names containing \\n', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await expect(
        client.get('/test', {
          headers: { 'X-Bad\nHeader': 'value' },
        }),
      ).rejects.toThrow('Invalid header');
    });
  });

  // ---------------------------------------------------------------------------
  // #14 Low: Network error message is generic
  // ---------------------------------------------------------------------------

  describe('#14 Generic network error message', () => {
    it('should use generic Network Error message instead of leaking details', async () => {
      const client = createHttpClient();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:8080')),
      );

      try {
        await client.get('/test');
        expect.fail('Should have thrown');
      } catch (err) {
        const error = err as HttpClientError;
        expect(error.message).toBe('Network Error');
        expect(error.message).not.toContain('10.0.0.1');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH method
  // ---------------------------------------------------------------------------

  describe('PATCH method', () => {
    it('should execute PATCH request with data', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { id: 1 })));

      const payload = { name: 'patched' };
      await client.patch('/update/1', payload);

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('PATCH');
      expect(init.body).toBe(JSON.stringify(payload));
    });
  });

  // ---------------------------------------------------------------------------
  // Credentials passthrough
  // ---------------------------------------------------------------------------

  describe('Credentials passthrough', () => {
    it('should pass credentials option to fetch', async () => {
      const client = createHttpClient({ credentials: 'include' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.credentials).toBe('include');
    });

    it('should not set credentials when not configured', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.credentials).toBeUndefined();
    });
  });
});
