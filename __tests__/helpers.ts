export function mockResponse(
  status: number,
  data: unknown,
  contentType = 'application/json',
): Response {
  const responseHeaders = new Headers({ 'content-type': contentType });
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: responseHeaders,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

export function mock204Response(): Response {
  return {
    status: 204,
    ok: true,
    headers: new Headers(),
    json: () => Promise.reject(new Error('No body')),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}
