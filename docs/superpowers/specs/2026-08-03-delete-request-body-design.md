# Design — `delete()` cannot send a request body

Issue: https://github.com/toteat/toteat-fetch/issues/1
Date: 2026-08-03
Status: approved

## Problem

`client.delete(url, config)` cannot send a request body, and a caller who passes one gets no signal.
`RequestConfig` has no `data` field, and `src/client.ts:76` hardcodes `undefined` as the body argument
to `buildConfig`, so a `config.data` supplied by the caller is discarded before the request is built.
The request goes out with no body and no `Content-Type`, the transport succeeds, and the endpoint
never receives what the caller meant to send.

Reproduced against the current tree (scratch vitest test, repo's own jsdom env):

```ts
await client.delete('/test', { data: { foo: 'bar' } } as any);
// OBSERVED init.body = undefined
```

The only present-day signal is `TS2353: 'data' does not exist in type 'RequestConfig'`, which a
consumer's pre-existing error baseline can hide — which is exactly what happened downstream.

### Blast radius (verified across /Volumes/Kingdian/toteat)

57 `.delete()` call sites across four consumers, all pinning `@toteat-eng/toteat-fetch@^0.2.1`:

| Consumer | `.delete()` sites | Second argument |
| --- | --- | --- |
| manager-frontend-react | 32 | 1 with `{ data }` (broken), 31 with none |
| trm_frontend_vue3 | 19 | none |
| pos-frontend-react | 6 | 2 with `{ skipAuthRefresh }`, 4 with none |
| reservations-frontend-react | 0 | — |

The single body-bearing DELETE is
`manager-frontend-react/src/features/settings/api/commentsApi.ts:57` →
`DELETE /locals/:id/settings/comment_settings`, which validates a JSON body server-side (query
parameters are not an alternative). It is the actual cause of
`toteat/manager-frontend-react#396` ("existing comments cannot be deleted"). The issue's claim of
exactly one body-bearing DELETE is confirmed.

No existing `.delete()` call site changes behaviour under this design. Nothing in `src/` or
`__tests__/` currently reads a `config.data`; no existing test passes a second argument to
`.delete()`. Baseline suite: 129 tests passing.

## Approach

Add `data?: unknown` to `RequestConfig` and resolve the body from it. Do **not** add a positional
`data` parameter to `delete`.

### Rejected: `delete(url, data?, config?)`

The shape suggested in the issue mirrors `post`/`put`/`patch`, but `data?: unknown` accepts anything,
so an existing `delete(url, { params: { x: 1 } })` call keeps compiling while its config object is
serialized as the request body and its params are dropped. That converts a silently-missing body into
a silently-wrong body — strictly worse, and equally invisible at the call site. Confirmed against the
real call sites above: two `pos-frontend-react` sites pass a non-body object as the second argument
and would be misread under that shape.

### Chosen shape

```ts
// src/types.ts
export interface RequestConfig {
  /** Request body. For methods that also take a positional `data` argument, pass one or the other. */
  data?: unknown;
  params?: Record<string, ParamValue | ParamValue[]>;
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  responseType?: ResponseType;
}
```

`FetchClientInstance.delete` keeps its signature: `(url: string, config?: RequestConfig)`.

Corroboration for preferring config-carried over positional: a third-party Node.js migration page in
the corpus lists axios's aliases as `axios.delete(url[, config])` against
`axios.post(url[, data[, config]])` — i.e. axios's `delete` has no positional data parameter
(`https://nodejs.org/en/blog/migrations/axios-to-fetch`, kb `1cd17e45-2191-4ac3-a191-f1a143a33b50`,
lines 1-64). **Unverified:** that axios's config field for the body is literally named `data` is not
in the corpus (no axios KB exists; logged to `~/.claude/RAG-BACKLOG.md`) — it is general knowledge
and the design does not rest on it. The decisive evidence is the downstream call site, which already
writes `{ data }`.

## Implementation

One resolution step at the top of `buildConfig` in `src/client.ts`; everything below it is unchanged.

```ts
function buildConfig(
  method: string,
  url: string,
  data?: unknown,
  config?: RequestConfig,
): InternalRequestConfig {
  if (data !== undefined && config?.data !== undefined) {
    throw new TypeError(
      `${method} ${url}: request body passed both positionally and as config.data. Pass one.`,
    );
  }
  const bodySource = data !== undefined ? data : config?.data;

  // Only GET: the client exposes no head(), so buildConfig('HEAD', ...) is unreachable.
  if (method === 'GET' && bodySource !== undefined && bodySource !== null) {
    throw new TypeError(`${method} ${url}: cannot send a request body.`);
  }
  // ...existing body serialization, reading bodySource instead of data
}
```

`delete` passes `undefined` positionally and lets the resolution step pick up `config.data`:

```ts
delete: <T = unknown>(url: string, config?: RequestConfig) =>
  executeRequest<T>(buildConfig('DELETE', url, undefined, config), interceptors),
```

Everything downstream already works: `isStreamBody` passes `FormData`/`Blob`/`ArrayBuffer`/
`URLSearchParams`/`ReadableStream` through untouched, objects are `JSON.stringify`-ed with
`Content-Type: application/json` auto-set unless the caller set one, and `request.ts` only attaches
`fetchInit.body` when it is neither `undefined` nor `null`. `FormData` bodies on DELETE come free.

## Semantics

- `delete(url, { data })` sends a JSON body with `Content-Type: application/json`. This is the exact
  call the blocked consumer already wrote.
- `config.data` is honoured on **every** method, so there is no method where it is silently ignored.
- `data: undefined` or `data: null` means no body, matching today's positional behaviour.
- Positional `data` and `config.data` together throw — ambiguous intent surfaces at the call site
  rather than one body silently winning. `post(url, undefined, { data })` is legal.
- A body on GET throws. The guard checks `method === 'GET'` only — `FetchClientInstance` exposes no
  `head()` method, so `buildConfig('HEAD', ...)` is unreachable, and HEAD must be added to the guard
  if one ever ships. Justification for guarding GET, confirmed both by spec and by runtime:
  - WHATWG Fetch, `new Request(input, init)` constructor steps: *"If either init\["body"\] exists and
    is non-null or inputBody is non-null, and request's method is `GET` or `HEAD`, then throw a
    TypeError."* (`https://fetch.spec.whatwg.org/`, kb `9479c4ff-4891-417a-b0e0-1878507a454c`,
    lines 5244-5475)
  - Node v24, observed: `fetch('https://example.com', { method: 'GET', body: 'x' })` →
    `TypeError: Request with GET/HEAD method cannot have body.` A plain `TypeError`, not a
    `DOMException`, so `request.ts`'s fetch `catch` classifies it as neither abort nor timeout and
    reports `HttpClientError: Network Error` — an opaque message that hides the cause. The guard
    replaces that with a message naming the actual mistake.
- A body that `JSON.stringify` cannot serialize (a top-level function, `Symbol`, or `undefined`)
  throws a `TypeError` before `Content-Type` is set, rather than silently sending no body with a
  JSON content-type. Bodies where the unserializable value is merely nested (e.g. `[fn]` → `'[null]'`,
  `{ fn }` → `'{}'`) are valid JSON and do not throw.

### All three guards throw synchronously

They are programmer errors, consistent with `createHttpClient`'s existing invalid-timeout
`TypeError`, and they fire before any interceptor runs. Consequence, stated deliberately: a caller
writing `client.get(url, cfg).catch(...)` rather than `try { await ... }` will not catch them. A body
on GET is not a runtime condition to recover from. `try`/`await`/`catch` — the shape used throughout
the consumers — does catch them.

### Known limitation, not fixed here

The body is bound at `buildConfig` time, so a request interceptor that rewrites `method` to `GET`
while a body is present still reaches `fetch` and surfaces as `Network Error`. Interceptors cannot
see or set `body` by design (`InterceptorRequestConfig` has no body field), so guarding that path
would mean widening the interceptor contract. Out of scope.

## Tests

New `describe` block in `__tests__/fetchClient.fixes.ts`, following the existing pattern
(`vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})))`, then assert against
`vi.mocked(fetch).mock.calls[0][1]`).

1. `delete('/x', { data: { foo: 'bar' } })` → `init.body === JSON.stringify({ foo: 'bar' })` and
   `Content-Type: application/json`. **This is the regression test — it must fail against the current
   tree before the fix.**
2. `delete('/x')` → no `body` key on init (existing behaviour preserved).
3. `delete('/x', { data, params, headers })` → body sent **and** query string built **and** headers
   merged: proves `data` does not cannibalize the rest of the config.
4. `delete('/x', { data: formData })` → `FormData` passed through untouched, no `Content-Type` forced.
5. `delete('/x', { data: null })` → no body.
6. `get('/x', { data: { a: 1 } })` → throws `TypeError`, and `fetch` was never called.
7. `post('/x', { a: 1 }, { data: { b: 2 } })` → throws `TypeError`, `fetch` never called.
8. `post('/x', undefined, { data: { b: 2 } })` → body sent from `config.data`.
9. Explicit `Content-Type` in config wins over the auto-set on a DELETE body.

All 129 existing tests must still pass.

## Docs and release

- `README.md:62` — add `data?: unknown` to the `RequestConfig` block, noting that DELETE bodies go
  through it and that GET/HEAD reject one. `client.delete<T>(url, config?)` at line 46 is unchanged.
- `package.json` → **0.2.2**. Additive and backward-compatible. A patch bump is deliberate: all four
  consumers pin `^0.2.1`, which would not accept `0.3.0`, and repo precedent is that the additive
  `responseType: 'blob'` feature shipped as the `0.2.0 → 0.2.1` patch bump.
- Follow-up in the consumer, out of scope for this repo: once `0.2.2` is installed,
  `manager-frontend-react/src/features/settings/api/commentsApi.ts` needs its "does not work yet"
  comment block removed and the `TS2353` suppression dropped, unblocking
  `toteat/manager-frontend-react#396`.

## Review tier

**STANDARD** — `code-reviewer`, `security-reviewer`, `pr-test-analyzer`. Ordinary library logic with
no secrets, auth, tenancy, network exposure, or data deletion. Not LIGHT: the change touches
request-building for every HTTP method and adds three throwing guards, so it has real runtime
behaviour. Not FULL: nothing here is a security boundary or a verification gate.
