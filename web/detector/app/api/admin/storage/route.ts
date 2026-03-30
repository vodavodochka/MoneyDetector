import { proxyJson } from "../../_proxy";

export async function GET(request: Request) {
  return proxyJson("/admin/storage", {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
