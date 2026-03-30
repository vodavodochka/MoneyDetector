import { proxyJson } from "../../_proxy";

export async function GET(
  request: Request,
  context: { params: Promise<{ task_id: string }> }
) {
  const { task_id } = await context.params;
  return proxyJson(`/result/${task_id}`, {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}
