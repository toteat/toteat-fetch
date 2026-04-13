# @toteat-eng/toteat-fetch

Minimal fetch-based HTTP client with an axios-compatible API surface. Zero external dependencies — uses native `fetch`.

## Install

```bash
npm install @toteat-eng/toteat-fetch
```

## Usage

```typescript
import { createHttpClient } from '@toteat-eng/toteat-fetch';

const client = createHttpClient({
  baseURL: 'https://api.example.com',
  headers: { Authorization: 'Bearer token' },
  timeout: 10000, // ms, default 30000
});

const response = await client.get<User>('/users/1');
console.log(response.data); // typed as User
```

## API

### `createHttpClient(config?)`

Creates a new HTTP client instance.

| Option | Type | Default | Description |
|---|---|---|---|
| `baseURL` | `string` | `''` | Base URL prepended to all request paths |
| `headers` | `Record<string, string>` | `{}` | Default headers for all requests |
| `timeout` | `number` | `30000` | Request timeout in milliseconds |
| `credentials` | `RequestCredentials` | — | Credentials mode (`'include'`, `'same-origin'`, `'omit'`) |

### Methods

```typescript
client.get<T>(url, config?)
client.post<T>(url, data?, config?)
client.put<T>(url, data?, config?)
client.patch<T>(url, data?, config?)
client.delete<T>(url, config?)
```

All methods return `Promise<FetchResponse<T>>`:

```typescript
interface FetchResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>; // keys are lowercased
}
```

### Per-request config

```typescript
interface RequestConfig {
  params?: Record<string, string | number | boolean | null | undefined | Array<...>>;
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal; // per-request cancellation
}
```

### Errors

All errors are `HttpClientError`:

```typescript
import { HttpClientError } from '@toteat-eng/toteat-fetch';

try {
  await client.get('/users/1');
} catch (err) {
  if (err instanceof HttpClientError) {
    console.log(err.message);            // "Request failed with status code 404"
    console.log(err.response?.status);   // 404
    console.log(err.response?.data);     // parsed response body
    console.log(err.cause);              // original fetch error (network errors)
  }
}
```

### Interceptors

```typescript
// Request interceptor — modify config before fetch
const id = client.interceptors.request.use(
  (config) => {
    config.headers['X-Request-Id'] = crypto.randomUUID();
    return config;
  },
  (error) => Promise.reject(error), // optional error handler
);

// Response interceptor — transform response
client.interceptors.response.use(
  async (response) => {
    // supports async
    return response;
  },
  async (error) => {
    // recover from errors or re-throw
    throw error;
  },
);

// Remove interceptor
client.interceptors.request.eject(id);
```

### Cancellation

```typescript
const controller = new AbortController();

client.get('/slow-endpoint', { signal: controller.signal });

// Cancel
controller.abort();
```

> **Note:** When you provide `signal`, the client-level `timeout` is not applied — your signal is used directly. If you need both cancellation and a timeout, combine them yourself:
> ```typescript
> const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
> client.get('/slow-endpoint', { signal });
> ```

## Axios compatibility

Drop-in for the axios subset used in toteat projects:

| Feature | Support |
|---|---|
| `response.data` | ✅ |
| `interceptors.request.use` / `.eject` | ✅ |
| `interceptors.response.use` / `.eject` | ✅ |
| `HttpClientError.response` | ✅ |
| `validateStatus` | ✅ |
| Async interceptors | ✅ |
| `baseURL` | ✅ |
| Query params (`params`) | ✅ |
| FormData / Blob / ArrayBuffer bodies | ✅ |

## Requirements

- Node >= 20
- Native `fetch` available (Node 18+, all modern browsers)
