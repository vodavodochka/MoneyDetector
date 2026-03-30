import { proxyJson } from "../_proxy";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const res = await proxyJson("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const nextRes = NextResponse.json(data, { status: res.status });
  if (data?.success && data?.token) {
    nextRes.cookies.set({
      name: "coin_detector_token",
      value: data.token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }
  return nextRes;
}
