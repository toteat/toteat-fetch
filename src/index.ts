/**
 * Minimal fetch-based HTTP client that matches the axios API surface
 * used in this project: .get(), .post(), interceptors, response.data.
 *
 * Zero external dependencies — uses native fetch.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchClientConfig {
  baseURL?: string;
  headers?: Record<string, string>;
  timeout?: number;
  credentials?: RequestCredentials;
}

export interface RequestConfig {
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
}

export interface FetchResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

export class HttpClientError extends Error {
  response?: { data: unknown; status: number; headers: Record<string, string> };

  constructor(
    message: string,
    status?: number,
    data?: unknown,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpClientError';
    if (status !== undefined) {
      this.response = { data, status, headers: headers ?? {} };
    }
  }
}

type RequestInterceptorType = (
  config: InternalRequestConfig,
) => InternalRequestConfig | Promise<InternalRequestConfig>;
type RequestErrorHandlerType = (
  error: unknown,
) => InternalRequestConfig | Promise<InternalRequestConfig>;
type ResponseInterceptorType = (response: FetchResponse) => FetchResponse;
type ResponseErrorHandlerType = (error: unknown) => Promise<FetchResponse>;

interface InterceptorEntry<F, R> {
  fulfilled: F;
  rejected?: R;
}

interface InternalRequestConfig {
  url: string;
  method: string;
  baseURL: string;
  headers: Record<string, string>;
  params: Record<string, unknown>;
  body?: BodyInit | null;
  timeout: number;
  validateStatus: (status: number) => boolean;
  credentials?: RequestCredentials;
}

// ---------------------------------------------------------------------------
// Interceptor manager
// ---------------------------------------------------------------------------

class InterceptorManager<F, R> {
  private _handlers: Array<InterceptorEntry<F, R> | null> = [];

  get handlers(): ReadonlyArray<InterceptorEntry<F, R> | null> {
    return this._handlers;
  }

  use(fulfilled: F, rejected?: R): number {
    this._handlers.push({ fulfilled, rejected });
    return this._handlers.length - 1;
  }

  eject(id: number): void {
    if (id >= 0 && id < this._handlers.length) {
      this._handlers[id] = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStreamBody(data: unknown): data is BodyInit {
  return (
    data instanceof FormData ||
    data instanceof Blob ||
    data instanceof ArrayBuffer ||
    data instanceof URLSearchParams ||
    data instanceof ReadableStream
  );
}

function validateHeaders(headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      throw new Error(`Invalid header: "${key}" contains forbidden characters`);
    }
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface FetchClientInstance {
  get: <T = unknown>(url: string, config?: RequestConfig) => Promise<FetchResponse<T>>;
  post: <T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ) => Promise<FetchResponse<T>>;
  put: <T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ) => Promise<FetchResponse<T>>;
  patch: <T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ) => Promise<FetchResponse<T>>;
  delete: <T = unknown>(url: string, config?: RequestConfig) => Promise<FetchResponse<T>>;
  interceptors: {
    request: InterceptorManager<RequestInterceptorType, RequestErrorHandlerType>;
    response: InterceptorManager<ResponseInterceptorType, ResponseErrorHandlerType>;
  };
}

const defaultValidateStatus = (status: number): boolean => status >= 200 && status < 300;

function buildUrl(base: string, path: string, params?: Record<string, unknown>): string {
  // Prevent absolute URLs from bypassing baseURL
  if (base && /^https?:\/\//i.test(path)) {
    throw new Error(`Absolute URL "${path}" is not allowed when baseURL is configured`);
  }

  const url = base ? `${base.replace(/\/$/, '')}${path}` : path;

  if (!params || Object.keys(params).length === 0) return url;

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          searchParams.append(key, String(item));
        }
      }
    } else {
      searchParams.append(key, String(value));
    }
  }
  const qs = searchParams.toString();
  if (!qs) return url;

  // Use & if URL already has a query string, ? otherwise
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}${qs}`;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function executeRequest<T>(
  config: InternalRequestConfig,
  interceptors: FetchClientInstance['interceptors'],
): Promise<FetchResponse<T>> {
  let processedConfig = { ...config };

  // Request interceptors — support async, chain errors
  for (const entry of interceptors.request.handlers) {
    if (entry?.fulfilled) {
      try {
        processedConfig = await Promise.resolve(entry.fulfilled(processedConfig));
      } catch (err) {
        if (entry.rejected) {
          processedConfig = await Promise.resolve(entry.rejected(err));
          continue;
        }
        throw err;
      }
    }
  }

  validateHeaders(processedConfig.headers);

  const url = buildUrl(processedConfig.baseURL, processedConfig.url, processedConfig.params);

  const fetchInit: globalThis.RequestInit = {
    method: processedConfig.method,
    headers: processedConfig.headers,
  };
  if (processedConfig.body !== undefined && processedConfig.body !== null) {
    fetchInit.body = processedConfig.body;
  }
  if (processedConfig.credentials !== undefined) {
    fetchInit.credentials = processedConfig.credentials;
  }

  // Timeout handling with proper cleanup
  let fallbackTimerId: ReturnType<typeof setTimeout> | undefined;

  let fetchResponse: Response;
  try {
    if (typeof AbortSignal.timeout === 'function') {
      fetchInit.signal = AbortSignal.timeout(processedConfig.timeout);
    } else {
      const controller = new AbortController();
      fallbackTimerId = setTimeout(() => {
        controller.abort();
      }, processedConfig.timeout);
      fetchInit.signal = controller.signal;
    }
    fetchResponse = await fetch(url, fetchInit);
  } catch (err) {
    const isTimeout =
      err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const error = new HttpClientError(
      isTimeout
        ? `timeout of ${processedConfig.timeout}ms exceeded`
        : 'Network Error',
    );
    // Chain through all response error interceptors
    let currentError: unknown = error;
    for (const entry of interceptors.response.handlers) {
      if (entry?.rejected) {
        try {
          return (await entry.rejected(currentError)) as FetchResponse<T>;
        } catch (nextErr) {
          currentError = nextErr;
        }
      }
    }
    throw currentError;
  } finally {
    if (fallbackTimerId !== undefined) {
      clearTimeout(fallbackTimerId);
    }
  }

  // Parse response body
  let data: T;
  const responseHeaders = headersToRecord(fetchResponse.headers);

  if (fetchResponse.status === 204) {
    data = null as unknown as T;
  } else {
    const contentType = fetchResponse.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        data = (await fetchResponse.json()) as T;
      } catch {
        data = (await fetchResponse.text()) as unknown as T;
      }
    } else {
      data = (await fetchResponse.text()) as unknown as T;
    }
  }

  const response: FetchResponse<T> = {
    data,
    status: fetchResponse.status,
    headers: responseHeaders,
  };

  const isValid = processedConfig.validateStatus(fetchResponse.status);
  if (!isValid) {
    const error = new HttpClientError(
      `Request failed with status code ${fetchResponse.status}`,
      fetchResponse.status,
      data,
      responseHeaders,
    );
    // Chain through all response error interceptors
    let currentError: unknown = error;
    for (const entry of interceptors.response.handlers) {
      if (entry?.rejected) {
        try {
          return (await entry.rejected(currentError)) as FetchResponse<T>;
        } catch (nextErr) {
          currentError = nextErr;
        }
      }
    }
    throw currentError;
  }

  let processedResponse: FetchResponse<T> = response;
  for (const entry of interceptors.response.handlers) {
    if (entry?.fulfilled) {
      processedResponse = entry.fulfilled(processedResponse) as FetchResponse<T>;
    }
  }

  return processedResponse;
}

export function createHttpClient(defaults: FetchClientConfig = {}): FetchClientInstance {
  const interceptors = {
    request: new InterceptorManager<RequestInterceptorType, RequestErrorHandlerType>(),
    response: new InterceptorManager<ResponseInterceptorType, ResponseErrorHandlerType>(),
  };

  function buildConfig(
    method: string,
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ): InternalRequestConfig {
    const mergedHeaders = { ...defaults.headers, ...config?.headers };

    let body: BodyInit | null | undefined;
    if (data !== undefined && data !== null) {
      if (isStreamBody(data)) {
        // FormData, Blob, ArrayBuffer, etc. — pass through, let browser set Content-Type
        body = data;
      } else {
        body = JSON.stringify(data);
        // Auto-set Content-Type for JSON bodies (axios compatibility)
        if (!mergedHeaders['Content-Type'] && !mergedHeaders['content-type']) {
          mergedHeaders['Content-Type'] = 'application/json';
        }
      }
    }

    return {
      url,
      method,
      baseURL: defaults.baseURL ?? '',
      headers: mergedHeaders,
      params: config?.params ?? {},
      body,
      timeout: defaults.timeout ?? 30000,
      validateStatus: config?.validateStatus ?? defaultValidateStatus,
      credentials: defaults.credentials,
    };
  }

  return {
    interceptors,
    get: <T = unknown>(url: string, config?: RequestConfig) =>
      executeRequest<T>(buildConfig('GET', url, undefined, config), interceptors),
    post: <T = unknown>(url: string, data?: unknown, config?: RequestConfig) =>
      executeRequest<T>(buildConfig('POST', url, data, config), interceptors),
    put: <T = unknown>(url: string, data?: unknown, config?: RequestConfig) =>
      executeRequest<T>(buildConfig('PUT', url, data, config), interceptors),
    patch: <T = unknown>(url: string, data?: unknown, config?: RequestConfig) =>
      executeRequest<T>(buildConfig('PATCH', url, data, config), interceptors),
    delete: <T = unknown>(url: string, config?: RequestConfig) =>
      executeRequest<T>(buildConfig('DELETE', url, undefined, config), interceptors),
  };
}
