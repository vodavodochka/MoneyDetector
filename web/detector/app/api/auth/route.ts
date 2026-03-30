import { proxyJson } from "../_proxy";

export async function GET(request: Request) {
  return proxyJson("/auth", {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
