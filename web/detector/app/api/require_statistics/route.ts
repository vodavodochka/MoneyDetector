import { proxyJson } from "../_proxy";

export async function GET(request: Request) {
  return proxyJson("/require_statistics", {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
