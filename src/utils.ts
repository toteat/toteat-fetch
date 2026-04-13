import { HttpClientError } from './types.js';
import type { ParamValue } from './types.js';

export function isStreamBody(data: unknown): data is BodyInit {
  return (
    data instanceof FormData ||
    data instanceof Blob ||
    data instanceof ArrayBuffer ||
    data instanceof URLSearchParams ||
    data instanceof ReadableStream
  );
}

export function validateHeaders(headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(key)) {
      throw new HttpClientError(
        `Invalid header: name "${key}" contains forbidden characters`,
      );
    }
    if (/[\r\n]/.test(value)) {
      throw new HttpClientError(
        `Invalid header "${key}": value contains forbidden characters`,
      );
    }
  }
}

export function buildUrl(
  base: string,
  path: string,
  params?: Record<string, ParamValue | ParamValue[]>,
): string {
  if (base) {
    // Reject absolute URLs (http/https) and protocol-relative URLs (//)
    if (/^https?:\/\//i.test(path) || path.startsWith('//')) {
      throw new HttpClientError(`Absolute URL "${path}" is not allowed when baseURL is configured`);
    }
    // Ensure exactly one slash between base and path
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return appendParams(`${base.replace(/\/$/, '')}${normalizedPath}`, params);
  }

  return appendParams(path, params);
}

function appendParams(
  url: string,
  params?: Record<string, ParamValue | ParamValue[]>,
): string {
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

  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}${qs}`;
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
