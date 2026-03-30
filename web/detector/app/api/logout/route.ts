import { proxyJson } from "../_proxy";

export async function POST(request: Request) {
  return proxyJson("/logout", {
    method: "POST",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
