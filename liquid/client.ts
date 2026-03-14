import "dotenv/config";
import crypto from "crypto";

const BASE_URL =
  process.env.LIQUID_BASE_URL ||
  "https://prometheus-prod--liquid-public-api-public-fastapi-app.modal.run";
const HEADER_KEY = "X-Liquid-Key";
const HEADER_TIMESTAMP = "X-Liquid-Timestamp";
const HEADER_NONCE = "X-Liquid-Nonce";
const HEADER_SIGNATURE = "X-Liquid-Signature";

function getEnv(name: string): string {
  const val = process.env[name];
  if (val == null || val === "") {
    throw new Error(`Missing env: ${name}`);
  }
  return val;
}

function canonicalizePath(path: string): string {
  const pathOnly = path.replace(/\?.*$/, "").replace(/\/+$/, "").toLowerCase();
  return pathOnly || "/";
}

function canonicalizeQuery(queryString: string): string {
  if (!queryString) return "";
  const params = new URLSearchParams(queryString);
  const sorted = [...params.entries()].sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
  );
  return sorted.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

function computeBodyHash(body: string | null): string {
  if (!body || body.length === 0) {
    return crypto.createHash("sha256").update("").digest("hex");
  }
  try {
    const parsed = JSON.parse(body) as object;
    const canonical = JSON.stringify(parsed, Object.keys(parsed).sort());
    return crypto.createHash("sha256").update(canonical).digest("hex");
  } catch {
    return crypto.createHash("sha256").update(body).digest("hex");
  }
}

function signRequest(
  secret: string,
  method: string,
  path: string,
  queryString: string,
  body: string | null
): { timestamp: string; nonce: string; signature: string } {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString("hex");
  const canonicalPath = canonicalizePath(path);
  const canonicalQuery = canonicalizeQuery(queryString);
  const bodyHash = computeBodyHash(body);
  const message = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${canonicalPath}\n${canonicalQuery}\n${bodyHash}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  return { timestamp, nonce, signature };
}

export type RequestInitAuth = RequestInit & { skipAuth?: boolean };

/**
 * Authenticated fetch for Liquid (tryliquid.xyz) API.
 * - HMAC-SHA256 signing with X-Liquid-Key, X-Liquid-Timestamp, X-Liquid-Nonce, X-Liquid-Signature.
 * - Unwraps { success, data } envelope; throws on success: false.
 * - 401 → log auth failure; 429 → wait 1000ms, retry once; 422 → log body.
 */
export async function liquidFetch(
  path: string,
  init: RequestInitAuth = {}
): Promise<Response> {
  const { skipAuth, ...fetchInit } = init;
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const method = (fetchInit.method || "GET").toUpperCase();

  const headers = new Headers(fetchInit.headers as HeadersInit);
  headers.set("Content-Type", "application/json");

  let body: string | null = null;
  if (fetchInit.body != null) {
    body = typeof fetchInit.body === "string" ? fetchInit.body : "";
  }

  if (!skipAuth) {
    const apiKey = getEnv("LIQUID_API_KEY");
    const apiSecret = getEnv("LIQUID_API_SECRET");
    const [pathPart, queryPart] = path.split("?");
    const queryString = queryPart ?? "";
    const { timestamp, nonce, signature } = signRequest(
      apiSecret,
      method,
      pathPart ?? path,
      queryString,
      body
    );
    headers.set(HEADER_KEY, apiKey);
    headers.set(HEADER_TIMESTAMP, timestamp);
    headers.set(HEADER_NONCE, nonce);
    headers.set(HEADER_SIGNATURE, signature);
  }

  const doRequest = async (): Promise<Response> => {
    const res = await fetch(url, { ...fetchInit, headers, body });
    if (res.status === 401) {
      console.error(
        "Auth failed — check LIQUID_API_KEY / LIQUID_API_SECRET or nonce collision"
      );
      return res;
    }
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000));
      const apiKey = getEnv("LIQUID_API_KEY");
      const apiSecret = getEnv("LIQUID_API_SECRET");
      const [pathPart, queryPart] = path.split("?");
      const { timestamp, nonce, signature } = signRequest(
        apiSecret,
        method,
        pathPart ?? path,
        queryPart ?? "",
        body
      );
      headers.set(HEADER_KEY, apiKey);
      headers.set(HEADER_TIMESTAMP, timestamp);
      headers.set(HEADER_NONCE, nonce);
      headers.set(HEADER_SIGNATURE, signature);
      const retry = await fetch(url, { ...fetchInit, headers, body });
      if (retry.status === 401) {
        console.error(
          "Auth failed — check LIQUID_API_KEY / LIQUID_API_SECRET or nonce collision"
        );
      }
      return retry;
    }
    if (res.status === 422) {
      const text = await res.text();
      console.error("Liquid 422 Unprocessable Entity:", text);
      return res;
    }
    return res;
  };

  return doRequest();
}

/** Unwrap { success, data } envelope; throw with error message if !success. */
export async function parseResponse<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    const msg = `Liquid API ${res.status}: ${res.statusText} — ${text}`;
    console.error(msg);
    throw new Error(msg);
  }
  if (!text) return undefined as T;
  const data = JSON.parse(text) as { success?: boolean; data?: T; error?: { code?: string; message?: string } };
  if (data && typeof data.success === "boolean") {
    if (data.success) return data.data as T;
    const err = data.error;
    const message = err?.message ?? "Unknown error";
    const code = err?.code ?? "UNKNOWN";
    console.error(`Liquid API error: ${code} — ${message}`);
    throw new Error(`${code}: ${message}`);
  }
  return data as T;
}

export { BASE_URL, getEnv };
