import type {
  FetchClientConfig,
  RequestConfig,
  FetchClientInstance,
  InternalRequestConfig,
  RequestInterceptorType,
  RequestErrorHandlerType,
  ResponseInterceptorType,
  ResponseErrorHandlerType,
} from './types.js';
import { InterceptorManager } from './interceptors.js';
import { isStreamBody } from './utils.js';
import { executeRequest } from './request.js';

const defaultValidateStatus = (status: number): boolean =>
  status >= 200 && status < 300;

export function createHttpClient(defaults: FetchClientConfig = {}): FetchClientInstance {
  if (defaults.timeout !== undefined && (!Number.isFinite(defaults.timeout) || defaults.timeout <= 0)) {
    throw new TypeError(`Invalid timeout: ${defaults.timeout}. Must be a finite positive number.`);
  }

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
        body = data;
      } else {
        body = JSON.stringify(data);
        const hasContentType = Object.keys(mergedHeaders).some(
          (k) => k.toLowerCase() === 'content-type',
        );
        if (!hasContentType) {
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
      signal: config?.signal,
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
