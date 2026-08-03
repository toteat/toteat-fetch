# DELETE Request Body Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `client.delete(url, { data })` send a request body, and make a body passed to any method impossible to silently ignore.

**Architecture:** Add one optional field `data?: unknown` to the public `RequestConfig` interface, and one body-resolution step at the top of `buildConfig` in `src/client.ts` that reads it. No method signature changes. Everything downstream of `buildConfig` (JSON serialization, `Content-Type` auto-set, stream passthrough, `request.ts`) already handles a body and is untouched.

**Tech Stack:** TypeScript 6.x (strict, ES2022, NodeNext), vitest 2.x with jsdom env, zero runtime dependencies.

Spec: `docs/superpowers/specs/2026-08-03-delete-request-body-design.md`
Issue: https://github.com/toteat/toteat-fetch/issues/1

## Global Constraints

- **Zero external dependencies.** Native `fetch` only. Do not add any package to `package.json` dependencies.
- **Backward compatible.** All existing exports keep their current shapes. `FetchClientInstance.delete` keeps the signature `(url: string, config?: RequestConfig) => Promise<FetchResponse<T>>` — do NOT add a positional `data` parameter (see the spec's "Rejected" section for why).
- **Baseline: 129 tests passing** across `__tests__/fetchClient.browser.ts` (62) and `__tests__/fetchClient.fixes.ts` (67). All must still pass at every commit.
- **TypeScript strict:** no unused locals, no unused parameters. `npm run type-check` must be clean.
- Tests live in `__tests__/` and import from the package specifier `toteat-fetch` (aliased to `src/index.ts`), not from relative paths.
- Version bump target is **0.2.2** (patch, not minor) — all four consumers pin `^0.2.1` and would not receive `0.3.0`.
- Guards throw **synchronously** and use plain `TypeError` (not `HttpClientError`) — these are programmer errors, consistent with the existing invalid-timeout `TypeError` in `createHttpClient`.
- Branch: `fix/#1-delete-request-body`. Commit message format: `#1 <lowercase description>`.
- **Do NOT add `Co-Authored-By` trailers** to any commit.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/types.ts` | Modify `RequestConfig` (lines 21-27) | Public config surface — gains `data?: unknown` |
| `src/client.ts` | Modify `buildConfig` (lines 28-63) | Body resolution + the two guards |
| `__tests__/fetchClient.fixes.ts` | Append one `describe` block | Regression + guard coverage |
| `README.md` | Modify `RequestConfig` block (line 62) | Public docs |
| `package.json` | Modify `version` (line 3) | Release |

No new files. `src/request.ts`, `src/utils.ts`, `src/interceptors.ts`, `src/index.ts` are untouched — `data` is resolved to a `body` before it ever leaves `buildConfig`, and `InternalRequestConfig.body` already exists.

---

### Task 1: DELETE sends a body from `config.data`

The core fix and its regression test. Ends with the reported bug closed.

**Files:**
- Modify: `src/types.ts:21-27` (`RequestConfig`)
- Modify: `src/client.ts:28-63` (`buildConfig`), `src/client.ts:76-77` (`delete`)
- Test: `__tests__/fetchClient.fixes.ts` (append at end of the top-level `describe('Audit Fixes', ...)` block)

**Interfaces:**
- Consumes: `createHttpClient` from `toteat-fetch`; `mockResponse` from `./helpers.js`.
- Produces: `RequestConfig.data?: unknown` — the public field every later task builds on. `buildConfig(method: string, url: string, data?: unknown, config?: RequestConfig): InternalRequestConfig` keeps its existing signature; only its body reads `config.data`.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe('Audit Fixes', () => { ... })` block in `__tests__/fetchClient.fixes.ts`, following the file's existing comment-header style:

```ts
  // ---------------------------------------------------------------------------
  // #1 delete() can send a request body via config.data
  // ---------------------------------------------------------------------------

  describe('#1 DELETE request body', () => {
    it('should send a JSON body on DELETE when config.data is provided', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.delete('/test', { data: { foo: 'bar' } });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should send no body on DELETE when config.data is absent', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.delete('/test');

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBeUndefined();
    });

    it('should send no body on DELETE when config.data is null', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.delete('/test', { data: null });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBeUndefined();
    });

    it('should send the body alongside params and headers on DELETE', async () => {
      const client = createHttpClient({ baseURL: 'https://api.example.com' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.delete('/test', {
        data: { foo: 'bar' },
        params: { locale: 'es' },
        headers: { 'X-Custom': 'yes' },
      });

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('locale=es');
      expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('yes');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should pass a FormData body through untouched on DELETE without forcing Content-Type', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));
      const form = new FormData();
      form.append('key', 'value');

      await client.delete('/test', { data: form });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(form);
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('should not override an explicit Content-Type on a DELETE body', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.delete('/test', {
        data: { foo: 'bar' },
        headers: { 'Content-Type': 'application/vnd.api+json' },
      });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/vnd.api+json');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- -t "#1 DELETE request body"`

Expected: the first test FAILS on `expect(init.body).toBe('{"foo":"bar"}')` receiving `undefined`. Under TypeScript the `data` key is also a `TS2353` error — that is the same defect showing up in the type system and is expected at this step. The "no body when absent" and "no body when null" tests may already pass; that is correct, they are guards against regression.

- [ ] **Step 3: Add `data` to `RequestConfig`**

In `src/types.ts`, replace the `RequestConfig` interface:

```ts
export interface RequestConfig {
  /**
   * Request body. Serialized as JSON unless it is a stream/binary body
   * (FormData, Blob, ArrayBuffer, URLSearchParams, ReadableStream).
   * For methods that also take a positional `data` argument (post, put, patch),
   * pass one or the other — passing both throws a TypeError.
   * GET and HEAD cannot carry a body and throw a TypeError if given one.
   */
  data?: unknown;
  params?: Record<string, ParamValue | ParamValue[]>;
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  responseType?: ResponseType;
}
```

- [ ] **Step 4: Resolve the body from `config.data` in `buildConfig`**

In `src/client.ts`, inside `buildConfig`, replace the body-building block. The existing block starts at `const mergedHeaders = ...` and ends before `return {`. Only the body source changes — the serialization logic below it is unchanged:

```ts
    const mergedHeaders = { ...defaults.headers, ...config?.headers };

    const bodySource = data !== undefined ? data : config?.data;

    let body: BodyInit | null | undefined;
    if (bodySource !== undefined && bodySource !== null) {
      if (isStreamBody(bodySource)) {
        body = bodySource;
      } else {
        body = JSON.stringify(bodySource);
        const hasContentType = Object.keys(mergedHeaders).some(
          (k) => k.toLowerCase() === 'content-type',
        );
        if (!hasContentType) {
          mergedHeaders['Content-Type'] = 'application/json';
        }
      }
    }
```

Leave the `return { ... }` object exactly as it is — it already passes `body` through.

`delete` needs no change: it already calls `buildConfig('DELETE', url, undefined, config)`, and `bodySource` now falls through to `config.data`. Verify the line at `src/client.ts:76-77` still reads:

```ts
    delete: <T = unknown>(url: string, config?: RequestConfig) =>
      executeRequest<T>(buildConfig('DELETE', url, undefined, config), interceptors),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- -t "#1 DELETE request body"`
Expected: 6 passed.

Then run the full suite and the type-check:

Run: `npm test`
Expected: `Tests  135 passed (135)` — the 129 baseline plus 6 new.

Run: `npm run type-check`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/client.ts __tests__/fetchClient.fixes.ts
git commit -m "#1 send a request body on delete via config.data"
```

---

### Task 2: Guards — no body can be silently ignored

Two `TypeError` guards so a body is never dropped or misdirected. Independently rejectable: Task 1 is the fix, this is the "cannot fail silently" requirement from the issue.

**Files:**
- Modify: `src/client.ts` (`buildConfig`, above the `bodySource` line added in Task 1)
- Test: `__tests__/fetchClient.fixes.ts` (append to the `describe('#1 DELETE request body', ...)` block from Task 1)

**Interfaces:**
- Consumes: `RequestConfig.data` and the `bodySource` resolution from Task 1.
- Produces: no new exports. Two synchronous `TypeError`s thrown from `buildConfig`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('#1 DELETE request body', ...)` block created in Task 1:

```ts
    it('should throw a TypeError when a body is passed to GET', () => {
      const client = createHttpClient();
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
      vi.stubGlobal('fetch', fetchMock);

      expect(() => client.get('/test', { data: { foo: 'bar' } })).toThrow(TypeError);
      expect(() => client.get('/test', { data: { foo: 'bar' } })).toThrow(
        /cannot send a request body/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should not throw on GET when config.data is null', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.get('/test', { data: null });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBeUndefined();
    });

    it('should throw a TypeError when a body is passed both positionally and as config.data', () => {
      const client = createHttpClient();
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
      vi.stubGlobal('fetch', fetchMock);

      expect(() => client.post('/test', { a: 1 }, { data: { b: 2 } })).toThrow(TypeError);
      expect(() => client.post('/test', { a: 1 }, { data: { b: 2 } })).toThrow(
        /both positionally and as config\.data/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should send the body from config.data when the positional data is undefined', async () => {
      const client = createHttpClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));

      await client.post('/test', undefined, { data: { b: 2 } });

      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.body).toBe(JSON.stringify({ b: 2 }));
    });
```

Note on the two `expect(() => ...)` calls per guard test: the guards throw synchronously, so `client.get(...)` never returns a promise and there is no unhandled rejection. Calling it twice to assert both the class and the message is intentional and safe.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- -t "#1 DELETE request body"`
Expected: the two guard tests FAIL. `client.get('/test', { data })` does not throw — it reaches `fetch`, so `expect(...).toThrow(TypeError)` fails with "received function did not throw". The `post` conflict test fails the same way. The two non-throwing tests should already pass.

- [ ] **Step 3: Implement the guards**

In `src/client.ts`, inside `buildConfig`, insert immediately above the `const bodySource = ...` line added in Task 1 (before `mergedHeaders` is used, so the order is: guards, then `mergedHeaders`, then `bodySource`). Final head of the function:

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

    if ((method === 'GET' || method === 'HEAD') && bodySource !== undefined && bodySource !== null) {
      throw new TypeError(`${method} ${url}: cannot send a request body.`);
    }

    const mergedHeaders = { ...defaults.headers, ...config?.headers };

    let body: BodyInit | null | undefined;
    // ...unchanged from Task 1
```

Move the `bodySource` declaration above `mergedHeaders` as shown — the GET/HEAD guard needs it, and nothing between them uses `mergedHeaders`.

Why `TypeError` and not `HttpClientError`: these are programmer errors caught at call time, matching the existing invalid-timeout `TypeError` thrown by `createHttpClient`. Why the GET/HEAD guard exists at all: WHATWG Fetch requires `new Request()` to throw a `TypeError` for a non-null body on GET/HEAD, and Node's `fetch` throws `TypeError: Request with GET/HEAD method cannot have body.` — which `request.ts` would catch and report as the opaque `HttpClientError: Network Error`, hiding the cause.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- -t "#1 DELETE request body"`
Expected: 10 passed.

Run: `npm test`
Expected: `Tests  139 passed (139)`.

Run: `npm run type-check`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts __tests__/fetchClient.fixes.ts
git commit -m "#1 reject a request body on get/head and a duplicated body"
```

---

### Task 3: Docs and version bump

**Files:**
- Modify: `README.md:59-68` (the "Per-request config" block)
- Modify: `package.json:3` (`version`)

**Interfaces:**
- Consumes: the final `RequestConfig` shape from Tasks 1-2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the README config block**

In `README.md`, replace the `interface RequestConfig` code block under "### Per-request config":

```typescript
interface RequestConfig {
  data?: unknown;       // request body — JSON-serialized unless FormData/Blob/ArrayBuffer/URLSearchParams/ReadableStream
  params?: Record<string, string | number | boolean | null | undefined | Array<...>>;
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal; // per-request cancellation
  responseType?: 'blob';
}
```

Then add this immediately below that code block:

````markdown
`delete` sends a body through `config.data`, since it takes no positional `data` argument:

```typescript
await client.delete('/locals/42/settings/comment_settings', { data: { id: 7 } });
```

A `TypeError` is thrown synchronously if a body is passed to `get`, or if `post`/`put`/`patch`
receive a body both positionally and as `config.data`.
````

Note the `responseType?: 'blob'` line: the README's `RequestConfig` block is currently missing it even though the field exists in `src/types.ts`. Adding it is a one-line accuracy fix to a block this task is already rewriting — not scope creep.

- [ ] **Step 2: Bump the version**

In `package.json`, change `"version": "0.2.1"` to `"version": "0.2.2"`.

Patch, not minor: all four monorepo consumers pin `^0.2.1`, which does not accept `0.3.0`, and the additive `responseType: 'blob'` feature shipped as the previous patch bump.

- [ ] **Step 3: Verify the build is clean**

Run: `npm run build`
Expected: exit 0, `dist/` written.

Run: `npm test`
Expected: `Tests  139 passed (139)`.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "#1 document the request body on delete and bump to 0.2.2"
```

---

## Verification before completion

- [ ] `npm test` → 139 passed, 0 failed. Paste the actual output.
- [ ] `npm run type-check` → exit 0, no output.
- [ ] `npm run build` → exit 0.
- [ ] `git diff main --stat` touches exactly: `src/types.ts`, `src/client.ts`, `__tests__/fetchClient.fixes.ts`, `README.md`, `package.json`, plus the spec and plan docs.
- [ ] Confirm by inspection that `FetchClientInstance.delete` in `src/types.ts` still reads `(url: string, config?: RequestConfig)` — no positional `data` parameter was added.
- [ ] Revert `src/client.ts`'s `bodySource` line to `data` alone, confirm the first regression test goes red, then restore. Evidence the test tests the fix.

## Review gate

**STANDARD tier** — dispatch in parallel, all must return zero MUST-FIX and zero IMPORTANT before any PR:
`pr-review-toolkit:code-reviewer`, `security-reviewer`, `pr-review-toolkit:pr-test-analyzer`.

Rationale: ordinary library logic, no secrets/auth/tenancy, no network exposure, no data migration. Not LIGHT — it changes request-building for every HTTP method and adds throwing guards. Not FULL — nothing here is a security boundary or a verification gate.

## Out of scope

- A positional `data` parameter on `delete`. Rejected in the spec: it would silently reinterpret an existing `delete(url, config)` call's config object as the request body.
- Guarding an interceptor that rewrites `method` to `GET` while a body is present. Interceptors cannot see or set `body` by design (`InterceptorRequestConfig` has no body field); guarding it means widening the interceptor contract.
- The downstream follow-up in `manager-frontend-react` (`src/features/settings/api/commentsApi.ts` — remove the "does not work yet" comment block once `0.2.2` is installed, unblocking `toteat/manager-frontend-react#396`). Different repo, separate PR.
- Publishing to npm. Human-gated.
