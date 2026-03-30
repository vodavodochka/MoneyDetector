import { proxyJson } from "../_proxy";

export async function POST(request: Request) {
  const formData = await request.formData();
  return proxyJson("/detect", {
    method: "POST",
    body: formData,
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
