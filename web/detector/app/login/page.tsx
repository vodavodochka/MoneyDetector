"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Space_Grotesk } from "next/font/google";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const API_BASE = "/api";

export default function LoginPage() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleLogin() {
    if (!login || !password) return;
    setStatus("loading");
    setError("");

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus("success");
        router.replace("/upload");
      } else {
        setStatus("error");
        setError("Неверный логин или пароль");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Не удалось выполнить вход");
    }
  }

  return (
    <div
      className={`${grotesk.className} min-h-screen bg-zinc-950 text-zinc-100`}
      style={{
        backgroundImage:
          "radial-gradient(1200px 500px at 10% -10%, #1d4ed8 0%, transparent 60%), radial-gradient(900px 420px at 90% 0%, #f97316 0%, transparent 55%), linear-gradient(180deg, #09090b 0%, #0f172a 100%)",
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            CoinDetector
          </Link>
          <Link
            href="/"
            className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-widest backdrop-blur transition hover:border-white/50 hover:bg-white/20"
          >
            Главная
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <h1 className="mt-4 text-3xl font-semibold">Вход</h1>

            <div className="mt-6 flex flex-col gap-4">
              <label className="text-sm text-white/70">
                Логин
                <input
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="Введите логин"
                />
              </label>
              <label className="text-sm text-white/70">
                Пароль
                <input
                  type="password"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>
              <button
                onClick={handleLogin}
                disabled={status === "loading"}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "loading" ? "Входим..." : "Войти"}
              </button>
              {status === "success" ? (
                <div className="text-sm text-emerald-200">Вход выполнен.</div>
              ) : null}
              {status === "error" ? (
                <div className="text-sm text-red-200">{error}</div>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
