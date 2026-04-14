import { HttpClientError } from './types.js';
import type {
  InternalRequestConfig,
  FetchResponse,
  IInterceptorPipeline,
  RequestInterceptorType,
  RequestErrorHandlerType,
  ResponseInterceptorType,
  ResponseErrorHandlerType,
} from './types.js';
import { validateHeaders, buildUrl, headersToRecord } from './utils.js';

type Interceptors = {
  request: IInterceptorPipeline<RequestInterceptorType, RequestErrorHandlerType>;
  response: IInterceptorPipeline<ResponseInterceptorType, ResponseErrorHandlerType>;
};

export async function executeRequest<T>(
  config: InternalRequestConfig,
  interceptors: Interceptors,
): Promise<FetchResponse<T>> {
  let processedConfig = { ...config, headers: { ...config.headers }, params: { ...config.params } };

  // -------------------------------------------------------------------------
  // Request interceptors — indexed loop so errors propagate to subsequent
  // rejected handlers (fix: errors no longer short-circuit the chain)
  // -------------------------------------------------------------------------
  const reqHandlers = interceptors.request.handlers;
  for (let i = 0; i < reqHandlers.length; i++) {
    const entry = reqHandlers[i];
    if (!entry?.fulfilled) continue;
    try {
      // Spread-merge preserves body (interceptors see InterceptorRequestConfig, no body field).
      // Note: interceptors that explicitly set a field to undefined will clobber the caller's
      // value (e.g. responseType: undefined from an interceptor removes a caller-set responseType).
      // Interceptors should return only the fields they intend to change.
      const result = await Promise.resolve(entry.fulfilled(processedConfig));
      processedConfig = { ...processedConfig, ...result };
    } catch (err) {
      let currentError: unknown = err;
      let resolved = false;
      // Propagate through this entry and all remaining rejected handlers
      for (let j = i; j < reqHandlers.length; j++) {
        const h = reqHandlers[j];
        if (!h?.rejected) continue;
        try {
          const result = await Promise.resolve(h.rejected(currentError));
          if (result == null) break; // null return: re-throw current error
          processedConfig = { ...processedConfig, ...result };
          resolved = true;
          i = j; // outer loop continues from j+1
          break;
        } catch (nextErr) {
          currentError = nextErr;
        }
      }
      if (!resolved) throw currentError;
    }
  }

  // Route CRLF/header validation errors through response interceptors
  // so error interceptors can handle them like any other HttpClientError
  try {
    validateHeaders(processedConfig.headers);
  } catch (err) {
    let currentError: unknown = err;
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

  let url: string;
  try {
    url = buildUrl(processedConfig.baseURL, processedConfig.url, processedConfig.params);
  } catch (err) {
    let currentError: unknown = err;
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

  let fallbackTimerId: ReturnType<typeof setTimeout> | undefined;
  let onSignalAbort: (() => void) | undefined; // hoisted for finally cleanup
  let timedOut = false;
  let fetchResponse: Response;

  try {
    if (processedConfig.signal) {
      if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
        fetchInit.signal = AbortSignal.any([
          processedConfig.signal,
          AbortSignal.timeout(processedConfig.timeout),
        ]);
      } else {
        // Fallback: proxy controller combines provided signal + manual timeout
        const proxyController = new AbortController();
        onSignalAbort = (): void => proxyController.abort(processedConfig.signal!.reason);
        processedConfig.signal.addEventListener('abort', onSignalAbort, { once: true });
        fallbackTimerId = setTimeout(() => {
          timedOut = true;
          if (onSignalAbort) {
            processedConfig.signal!.removeEventListener('abort', onSignalAbort);
            onSignalAbort = undefined;
          }
          // Use TimeoutError so catch block classifies this as a timeout, not an abort
          proxyController.abort(new DOMException(`timeout of ${processedConfig.timeout}ms exceeded`, 'TimeoutError'));
        }, processedConfig.timeout);
        fetchInit.signal = proxyController.signal;
      }
    } else if (typeof AbortSignal.timeout === 'function') {
      fetchInit.signal = AbortSignal.timeout(processedConfig.timeout);
    } else {
      const controller = new AbortController();
      fallbackTimerId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, processedConfig.timeout);
      fetchInit.signal = controller.signal;
    }
    fetchResponse = await fetch(url, fetchInit);
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const isTimeout = timedOut || (err instanceof DOMException && err.name === 'TimeoutError');
    const message = isTimeout
      ? `timeout of ${processedConfig.timeout}ms exceeded`
      : isAbort
        ? 'Request aborted'
        : 'Network Error';
    const error = new HttpClientError(message, undefined, undefined, undefined, err);
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
    // Clean up proxy signal listener if request completed without signal firing
    if (onSignalAbort !== undefined && processedConfig.signal) {
      processedConfig.signal.removeEventListener('abort', onSignalAbort);
    }
  }

  let data: T | null;
  const responseHeaders = headersToRecord(fetchResponse.headers);

  if (fetchResponse.status === 204) {
    data = null;
  } else if (processedConfig.responseType === 'blob') {
    try {
      data = (await fetchResponse.blob()) as unknown as T;
    } catch (blobErr) {
      throw new HttpClientError(
        `Failed to read blob response from ${processedConfig.method} ${processedConfig.url}: ${String(blobErr)}`,
        fetchResponse.status,
        undefined,
        responseHeaders,
        blobErr,   // preserve original blob error as cause
      );
    }
  } else {
    const contentType = fetchResponse.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        data = (await fetchResponse.json()) as T;
      } catch (parseErr) {
        throw new HttpClientError(
          `Failed to parse JSON response from ${processedConfig.method} ${processedConfig.url}: ${String(parseErr)}`,
          fetchResponse.status,
          undefined,
          responseHeaders,
          parseErr, // preserve original parse error as cause
        );
      }
    } else {
      try {
        data = (await fetchResponse.text()) as unknown as T;
      } catch (textErr) {
        throw new HttpClientError(
          `Failed to read response body from ${processedConfig.method} ${processedConfig.url}: ${String(textErr)}`,
          fetchResponse.status,
          undefined,
          responseHeaders,
          textErr, // preserve original read error as cause
        );
      }
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

  // -------------------------------------------------------------------------
  // Response fulfilled interceptors — on error, chain through remaining
  // rejected handlers then continue fulfilled loop (no early return on recovery)
  // -------------------------------------------------------------------------
  const handlerCount = interceptors.response.handlers.length;
  let processedResponse: FetchResponse<T> = response;
  for (let i = 0; i < handlerCount; i++) {
    const entry = interceptors.response.handlers[i];
    if (!entry?.fulfilled) continue;
    try {
      processedResponse = (await Promise.resolve(
        entry.fulfilled(processedResponse),
      )) as FetchResponse<T>;
    } catch (err) {
      let currentError: unknown = err;
      let resolved = false;
      for (let j = i; j < handlerCount; j++) {
        const h = interceptors.response.handlers[j];
        if (!h?.rejected) continue;
        try {
          processedResponse = (await h.rejected(currentError)) as FetchResponse<T>;
          resolved = true;
          i = j; // outer loop continues from j+1
          break;
        } catch (nextErr) {
          currentError = nextErr;
        }
      }
      if (!resolved) throw currentError;
    }
  }

  return processedResponse;
}
