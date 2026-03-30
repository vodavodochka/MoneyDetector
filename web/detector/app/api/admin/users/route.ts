import { proxyJson } from "../../_proxy";

export async function GET(request: Request) {
  return proxyJson("/admin/users", {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
