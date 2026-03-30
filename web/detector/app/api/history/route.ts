import { proxyJson } from "../_proxy";

export async function GET(request: Request) {
  return proxyJson("/history", {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
