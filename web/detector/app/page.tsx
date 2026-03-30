"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export default function Home() {
  const [isAuthed, setIsAuthed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth");
        const data = await res.json();
        setIsAuthed(Boolean(data.authorized));
      } catch {
        setIsAuthed(false);
      }
    };
    checkAuth();
  }, []);

  function handleLogout() {
    fetch("/api/logout", { method: "POST" }).catch(() => {});
    setIsAuthed(false);
    router.replace("/login");
  }

  return (
    <div
      className={`${grotesk.className} min-h-screen bg-zinc-950 text-zinc-100`}
      style={{
        backgroundImage:
          "radial-gradient(1200px 500px at 10% -10%, #1d4ed8 0%, transparent 60%), radial-gradient(900px 420px at 90% 0%, #f97316 0%, transparent 55%), linear-gradient(180deg, #09090b 0%, #0f172a 100%)",
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <div className="text-lg font-semibold tracking-tight">
            CoinDetector
          </div>
          {isAuthed ? (
            <div className="flex items-center gap-3">
              <Link
                href="/upload"
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur transition hover:border-white/50 hover:bg-white/20"
              >
                Открыть загрузку
              </Link>
              <button
                onClick={handleLogout}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur transition hover:border-white/50 hover:bg-white/20"
              >
                Выйти
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur transition hover:border-white/50 hover:bg-white/20"
            >
              Войти
            </Link>
          )}
        </header>

        <main className="flex flex-1 flex-col justify-center gap-10 py-12">
          <div className="flex flex-col gap-6">
            <div
              className={`${mono.className} text-xs uppercase tracking-[0.3em] text-white/60`}
            >
              Детекция · Очередь · Результат
            </div>
            <h1 className="text-4xl font-semibold leading-tight text-white sm:text-6xl">
              Подсчет денег по фото.
              <span className="block text-white/70">
                Загрузите снимок и получите сумму за несколько секунд.
              </span>
            </h1>
            <p className="max-w-2xl text-base text-white/70 sm:text-lg">
              Сервис распознает монеты и купюры, считает итоговую сумму и
              сохраняет историю анализов.
            </p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            {isAuthed ? (
              <Link
                href="/upload"
                className="rounded-full bg-white px-6 py-3 text-center text-sm font-semibold text-zinc-900 transition hover:bg-white/90"
              >
                Загрузить фото
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-full bg-white px-6 py-3 text-center text-sm font-semibold text-zinc-900 transition hover:bg-white/90"
              >
                Войти и продолжить
              </Link>
            )}
          </div>

          <section className="grid gap-4 sm:grid-cols-3" id="pipeline">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className={`${mono.className} text-xs text-white/60`}>
                Шаг 1
              </div>
              <div className="mt-2 text-lg font-semibold">Загрузка</div>
              <div className="mt-2 text-sm text-white/70">
                Пользователь отправляет фотографию на обработку.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className={`${mono.className} text-xs text-white/60`}>
                Шаг 2
              </div>
              <div className="mt-2 text-lg font-semibold">Обработка</div>
              <div className="mt-2 text-sm text-white/70">
                Запрос ставится в очередь и выполняется в фоне.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className={`${mono.className} text-xs text-white/60`}>
                Шаг 3
              </div>
              <div className="mt-2 text-lg font-semibold">Результат</div>
              <div className="mt-2 text-sm text-white/70">
                Вы получаете сумму и результат с найденными объектами.
              </div>
            </div>
          </section>

          <section className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <div className="text-xl font-semibold">
                Готовы проверить первое фото?
              </div>
              <div className="text-sm text-white/70">
                Откройте загрузчик и сохраняйте историю анализов.
              </div>
            </div>
            <Link
              href={isAuthed ? "/upload" : "/login"}
              className="rounded-xl bg-orange-500 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-orange-400"
            >
              {isAuthed ? "Открыть загрузку" : "Сначала войти"}
            </Link>
          </section>
        </main>
      </div>
    </div>
  );
}
