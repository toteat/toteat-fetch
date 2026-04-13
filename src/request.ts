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

  // Request interceptors — support async, chain errors
  for (const entry of interceptors.request.handlers) {
    if (entry?.fulfilled) {
      try {
        processedConfig = await Promise.resolve(entry.fulfilled(processedConfig));
      } catch (err) {
        if (entry.rejected) {
          const recovered = await Promise.resolve(entry.rejected(err));
          if (recovered == null) {
            throw err;
          }
          processedConfig = recovered;
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

  let fallbackTimerId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let fetchResponse: Response;

  try {
    if (processedConfig.signal) {
      // Combine per-request signal with timeout so both are honoured
      if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
        fetchInit.signal = AbortSignal.any([
          processedConfig.signal,
          AbortSignal.timeout(processedConfig.timeout),
        ]);
      } else {
        // Fallback for environments without AbortSignal.any (pre-Node 20, older browsers).
        // Combine provided signal + timeout via a proxy AbortController.
        const proxyController = new AbortController();
        const onSignalAbort = (): void => proxyController.abort(processedConfig.signal!.reason);
        processedConfig.signal.addEventListener('abort', onSignalAbort, { once: true });
        fallbackTimerId = setTimeout(() => {
          timedOut = true;
          processedConfig.signal!.removeEventListener('abort', onSignalAbort);
          proxyController.abort();
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
    const isTimeout =
      timedOut || (err instanceof DOMException && err.name === 'TimeoutError');
    const message = isTimeout
      ? `timeout of ${processedConfig.timeout}ms exceeded`
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
  }

  let data: T | null;
  const responseHeaders = headersToRecord(fetchResponse.headers);

  if (fetchResponse.status === 204) {
    data = null;
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

  const handlerCount = interceptors.response.handlers.length;
  let processedResponse: FetchResponse<T> = response;
  for (let i = 0; i < handlerCount; i++) {
    const entry = interceptors.response.handlers[i];
    if (entry?.fulfilled) {
      try {
        processedResponse = (await Promise.resolve(
          entry.fulfilled(processedResponse),
        )) as FetchResponse<T>;
      } catch (err) {
        // Fulfilled handler threw — propagate through this and remaining rejected handlers
        let currentError: unknown = err;
        for (let j = i; j < handlerCount; j++) {
          const h = interceptors.response.handlers[j];
          if (h?.rejected) {
            try {
              return (await h.rejected(currentError)) as FetchResponse<T>;
            } catch (nextErr) {
              currentError = nextErr;
            }
          }
        }
        throw currentError;
      }
    }
  }

  return processedResponse;
}
