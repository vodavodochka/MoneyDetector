import { proxyJson } from "../../_proxy";

export async function GET(request: Request) {
  const { search } = new URL(request.url);
  return proxyJson(`/admin/visits${search}`, {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
