// ---------------------------------------------------------------------------
// Public scalar types
// ---------------------------------------------------------------------------

export type ParamValue = string | number | boolean | null | undefined;

export type ResponseType = 'blob';

// ---------------------------------------------------------------------------
// Public config types
// ---------------------------------------------------------------------------

export interface FetchClientConfig {
  baseURL?: string;
  headers?: Record<string, string>;
  /** Milliseconds. Must be > 0. Defaults to 30000. */
  timeout?: number;
  credentials?: RequestCredentials;
}

export interface RequestConfig {
  params?: Record<string, ParamValue | ParamValue[]>;
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  responseType?: ResponseType;
}

export interface FetchResponse<T = unknown> {
  data: T | null;
  status: number;
  /** All keys are lowercased (HTTP header normalization). */
  headers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// HttpClientError
// ---------------------------------------------------------------------------

export class HttpClientError extends Error {
  readonly response?: Readonly<{ data: unknown; status: number; headers: Readonly<Record<string, string>> }>;

  constructor(
    message: string,
    status?: number,
    data?: unknown,
    headers?: Record<string, string>,
    cause?: unknown,
  ) {
    super(message, { cause });
    Object.defineProperty(this, 'name', { value: 'HttpClientError', writable: false, enumerable: false, configurable: false });
    if (status !== undefined) {
      this.response = Object.freeze({ data, status, headers: Object.freeze({ ...(headers ?? {}) }) }) as Readonly<{ data: unknown; status: number; headers: Readonly<Record<string, string>> }>;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal interceptor types
// ---------------------------------------------------------------------------

/** Public interface for request interceptor configs. Body is transport-layer only — not visible to interceptors. */
export interface InterceptorRequestConfig {
  url: string;
  method: string;
  baseURL: string;
  headers: Record<string, string>;
  params: Record<string, ParamValue | ParamValue[]>;
  timeout: number;
  validateStatus: (status: number) => boolean;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  responseType?: ResponseType;
}

export type RequestInterceptorType = (
  config: InterceptorRequestConfig,
) => InterceptorRequestConfig | Promise<InterceptorRequestConfig>;

export type RequestErrorHandlerType = (
  error: unknown,
) => InterceptorRequestConfig | null | undefined | Promise<InterceptorRequestConfig | null | undefined>;

export type ResponseInterceptorType = (
  response: FetchResponse,
) => FetchResponse | Promise<FetchResponse>;

export type ResponseErrorHandlerType = (
  error: unknown,
) => FetchResponse | Promise<FetchResponse>;

export interface InterceptorEntry<F, R> {
  fulfilled: F;
  rejected?: R;
}

// ---------------------------------------------------------------------------
// Internal request config
// ---------------------------------------------------------------------------

export interface InternalRequestConfig extends InterceptorRequestConfig {
  body?: BodyInit | null;
}

// ---------------------------------------------------------------------------
// Interceptor manager interfaces
// ---------------------------------------------------------------------------

/**
 * Public interface — users interact with use() and eject() only.
 * Does not expose internal handler storage.
 */
export interface IInterceptorManager<F, R> {
  use(fulfilled: F, rejected?: R): number;
  eject(id: number): void;
}

/**
 * Internal interface — extends the public interface with handler iteration.
 * Used by executeRequest to walk the interceptor chain.
 */
export interface IInterceptorPipeline<F, R> extends IInterceptorManager<F, R> {
  readonly handlers: ReadonlyArray<InterceptorEntry<F, R> | null>;
}

// ---------------------------------------------------------------------------
// Client instance interface
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
    request: IInterceptorManager<RequestInterceptorType, RequestErrorHandlerType>;
    response: IInterceptorManager<ResponseInterceptorType, ResponseErrorHandlerType>;
  };
}
