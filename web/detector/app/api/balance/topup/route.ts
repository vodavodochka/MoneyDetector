import { proxyJson } from "../../_proxy";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));

  return proxyJson("/balance/topup", {
    method: "POST",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
