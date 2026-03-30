import { proxyRaw } from "../../_proxy";

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await context.params;
  const safePath = (path ?? []).join("/");
  return proxyRaw(`/results/${safePath}`, {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      accept: request.headers.get("accept") ?? "image/*",
    },
  });
}
