/**
 * The one way the apps talk to the server. In the demo, MSW answers these requests in the browser
 * (VITE_USE_MOCKS=true); in production the same calls go to FastAPI. Auth is an httpOnly cookie set by
 * the server, so nothing here reads or stores tokens.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, field?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
    this.details = details;
  }

  /** No response at all (network down, timeout). Safe to retry with the same idempotency key. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Sent as Idempotency-Key on posting requests so a retry or double-click can't create two documents. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export const API_BASE = "/api";

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, idempotencyKey, signal } = options;
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "No response from the server.");
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    // The real backend nests the error ({ error: { code, message, field, details } }); the demo mocks send it flat.
    type ErrorBody = { code?: string; message?: string; field?: string; details?: unknown };
    const raw = (data ?? {}) as ErrorBody & { error?: ErrorBody };
    const err: ErrorBody = raw.error && typeof raw.error === "object" ? raw.error : raw;
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? res.statusText, err.field, err.details);
  }
  return data as T;
}

/** A fresh idempotency key per draft (receipt, voucher, cancellation). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
