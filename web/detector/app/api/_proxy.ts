const API_BASE = process.env.API_BASE || "http://127.0.0.1:8000";
const DEFAULT_TIMEOUT_MS = 5000;

function withTimeout(init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return {
    init: { ...init, signal: controller.signal },
    cancel: () => clearTimeout(id),
  };
}

export async function proxyJson(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const { init: timedInit, cancel } = withTimeout(init);
  try {
    const res = await fetch(`${API_BASE}${url}`, timedInit);
    const data = await res.json();
    const nextRes = new Response(JSON.stringify(data), {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      nextRes.headers.set("set-cookie", setCookie);
    }
    return nextRes;
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "upstream_unreachable",
        message: err instanceof Error ? err.message : "Upstream error",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  } finally {
    cancel();
  }
}

export async function proxyRaw(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const { init: timedInit, cancel } = withTimeout(init);
  try {
    const res = await fetch(`${API_BASE}${url}`, timedInit);
    const buffer = await res.arrayBuffer();
    const headers = new Headers();
    const contentType = res.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      headers.set("content-length", contentLength);
    }
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      headers.set("set-cookie", setCookie);
    }
    headers.set("cache-control", "no-store");
    return new Response(buffer, { status: res.status, headers });
  } catch (err) {
    return new Response(
      `Upstream error: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 502 }
    );
  } finally {
    cancel();
  }
}
