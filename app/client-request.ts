export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiRequestError';
  }
}

function responseError(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('error' in value)) return undefined;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'string' && error.trim() ? error.trim() : undefined;
}

export async function requestJson<T>(input: RequestInfo | URL, fallbackMessage: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (cause) {
    throw new ApiRequestError(fallbackMessage, 0, { cause });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ApiRequestError(fallbackMessage, response.status, { cause });
  }

  if (!response.ok) {
    throw new ApiRequestError(responseError(body) || fallbackMessage, response.status);
  }
  return body as T;
}
