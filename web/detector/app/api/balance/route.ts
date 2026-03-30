import { proxyJson } from "../_proxy";

export async function GET(request: Request) {
  return proxyJson("/balance", {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
