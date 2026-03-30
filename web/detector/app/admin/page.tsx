"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

type AdminUser = {
  id: number;
  login: string;
  tg_uuid?: string | null;
  created?: string | null;
};

type SeriesItem = {
  ts: string;
  count: number;
};

type StorageStats = {
  users_count: number;
  user_data_mb: number;
  total_disk_mb: number;
};

type ChartProps = {
  title: string;
  subtitle: string;
  data: SeriesItem[];
  granularity: "hour" | "day";
  accent: string;
};

type CalendarInputProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
};

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "юнь",
  "юль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateValue(value: string) {
  const [y, m, d] = value.split("-").map((item) => Number(item));
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function CalendarInput({ value, onChange, label }: CalendarInputProps) {
  const parsed = parseDateValue(value);
  const initial = parsed
    ? new Date(parsed.y, parsed.m - 1, parsed.d)
    : new Date();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(initial.getMonth());
  const [year, setYear] = useState(initial.getFullYear());
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (parsed) {
      setMonth(parsed.m - 1);
      setYear(parsed.y);
    }
  }, [value]);

  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handle);
    return () => window.removeEventListener("mousedown", handle);
  }, []);

  const firstDay = new Date(year, month, 1);
  const startDay = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const years = Array.from({ length: 7 }, (_, i) => year - 3 + i);

  return (
    <div className="relative" ref={ref}>
      <label className="flex flex-col gap-2 text-sm text-white/70">
        {label}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-left text-white"
        >
          <span>{value || "Выберите дату"}</span>
          <span className="text-white/40">▼</span>
        </button>
      </label>

      {open ? (
        <div className="absolute z-20 mt-2 w-72 rounded-2xl border border-white/10 bg-zinc-950 p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                const next = new Date(year, month - 1, 1);
                setMonth(next.getMonth());
                setYear(next.getFullYear());
              }}
              className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              ←
            </button>
            <div className="flex items-center gap-2">
              <select
                value={month}
                onChange={(event) => setMonth(Number(event.target.value))}
                className="rounded-lg border border-white/10 bg-zinc-950 px-2 py-1 text-xs text-white"
              >
                {MONTHS.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                className="rounded-lg border border-white/10 bg-zinc-950 px-2 py-1 text-xs text-white"
              >
                {years.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = new Date(year, month + 1, 1);
                setMonth(next.getMonth());
                setYear(next.getFullYear());
              }}
              className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-white/50">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1">
            {Array.from({ length: startDay }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const currentValue = `${year}-${pad(month + 1)}-${pad(day)}`;
              const isSelected = currentValue === value;
              return (
                <button
                  type="button"
                  key={currentValue}
                  onClick={() => {
                    onChange(currentValue);
                    setOpen(false);
                  }}
                  className={`rounded-lg px-2 py-1 text-xs transition ${
                    isSelected
                      ? "bg-white text-zinc-900"
                      : "text-white/80 hover:bg-white/10"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toLocalIsoWithOffset(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(abs / 60));
  const offsetMins = pad(abs % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`;
}

function parseDateInput(value: string) {
  const [y, m, d] = value.split("-").map((item) => Number(item));
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function formatBucketLabel(value: string, granularity: "hour" | "day") {
  const dt = new Date(value);
  if (granularity === "hour") {
    return dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return dt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

function Chart({ title, subtitle, data, granularity, accent }: ChartProps) {
  const x = useMemo(() => data.map((item) => item.ts), [data]);
  const y = useMemo(() => data.map((item) => item.count), [data]);

  const trace = useMemo(() => ({
    x,
    y,
    type: "bar",
    marker: {
      color: accent,
      line: { color: "rgba(255,255,255,0.15)", width: 1 },
    },
    hovertemplate:
      granularity === "hour"
        ? "%{x|%d.%m.%y %H:%M}<br>: %{y}<extra></extra>"
        : "%{x|%d.%m.%y}<br>: %{y}<extra></extra>",
  }), [x, y, accent, granularity]);

  const layout = useMemo(() => ({
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(9,9,11,0.6)",
    margin: { l: 50, r: 20, t: 20, b: 60 },
    xaxis: {
      type: "date",
      gridcolor: "rgba(255,255,255,0.06)",
      tickfont: { color: "rgba(255,255,255,0.6)" },
      tickformat: granularity === "hour" ? "%H:%M" : "%d.%m",
    },
    yaxis: {
      gridcolor: "rgba(255,255,255,0.08)",
      zerolinecolor: "rgba(255,255,255,0.25)",
      tickfont: { color: "rgba(255,255,255,0.6)" },
    },
    bargap: 0.2,
    font: { color: "#e4e4e7", family: "IBM Plex Mono, monospace" },
  }), [granularity]);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.08),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(249,115,22,0.08),transparent_40%)]" />
      <div className="relative">
        <div className={`${mono.className} text-xs uppercase tracking-[0.3em] text-white/50`}>
          {subtitle}
        </div>
        <div className="mt-2 text-xl font-semibold">{title}</div>

        {data.length === 0 ? (
          <div className="mt-6 text-sm text-white/60">    .</div>
        ) : (
          <div className="mt-6 rounded-xl border border-white/10 bg-zinc-950/60 p-2 shadow-inner">
            <Plot
              data={[trace as any]}
              layout={layout as any}
              config={{
                displayModeBar: true,
                displaylogo: false,
                responsive: true,
                modeBarButtonsToRemove: [
                  "select2d",
                  "lasso2d",
                  "autoScale2d",
                  "toggleSpikelines",
                ],
              }}
              style={{ width: "100%", height: "360px" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
export default function AdminPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState<AdminUser[]>([]);

  const [interval, setInterval] = useState<"day" | "month" | "three_months" | "custom">(
    "day"
  );
  const today = new Date();
  const [anchorDate, setAnchorDate] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`
  );
  const [customStartDate, setCustomStartDate] = useState("");
  const [customStartTime, setCustomStartTime] = useState("00:00");
  const [customEndDate, setCustomEndDate] = useState("");
  const [customEndTime, setCustomEndTime] = useState("23:59");

  const [visitsData, setVisitsData] = useState<SeriesItem[]>([]);
  const [newUsersData, setNewUsersData] = useState<SeriesItem[]>([]);
  const [granularity, setGranularity] = useState<"hour" | "day">("day");
  const [applyError, setApplyError] = useState("");
  const [storage, setStorage] = useState<StorageStats | null>(null);

  const filteredUsers = useMemo(() => users, [users]);

  const buildRange = useCallback((): { ok: false; error: string } | { ok: true; start: string; end: string; granularity: "hour" | "day" } => {
    const parsed = parseDateInput(anchorDate);
    if (!parsed) {
      return { ok: false, error: "Некорректная дата." };
    }
    const endDate = new Date(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0, 0);
    if (Number.isNaN(endDate.getTime())) {
      return { ok: false, error: "Некорректная дата." };
    }

    let start: string;
    let end: string;

    if (interval === "day") {
      const startDate = new Date(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0, 0);
      const endOfDay = new Date(parsed.y, parsed.m - 1, parsed.d, 23, 59, 59, 0);
      start = toLocalIsoWithOffset(startDate);
      end = toLocalIsoWithOffset(endOfDay);
    } else if (interval === "month") {
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 0);
      start = toLocalIsoWithOffset(startDate);
      end = toLocalIsoWithOffset(endOfDay);
    } else if (interval === "three_months") {
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 3);
      startDate.setHours(0, 0, 0, 0);
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 0);
      start = toLocalIsoWithOffset(startDate);
      end = toLocalIsoWithOffset(endOfDay);
    } else {
      if (!customStartDate || !customEndDate) {
        return { ok: false, error: "Укажите начало и конец интервала." };
      }
      const startDate = new Date(
        `${customStartDate}T${customStartTime || "00:00"}:00`
      );
      const endDateCustom = new Date(
        `${customEndDate}T${customEndTime || "23:59"}:00`
      );
      start = toLocalIsoWithOffset(startDate);
      end = toLocalIsoWithOffset(endDateCustom);
    }

    const startDt = new Date(start);
    const endDt = new Date(end);
    if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
      return { ok: false, error: "Некорректный интервал." };
    }
    if (endDt < startDt) {
      return { ok: false, error: "Конец интервала раньше начала." };
    }
    const diffMs = endDt.getTime() - startDt.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > 93) {
      return { ok: false, error: "Интервал не должен превышать 3 месяца." };
    }

    const bucket = startDt.toDateString() === endDt.toDateString() ? "hour" : "day";
    return { ok: true, start, end, granularity: bucket };
  }, [anchorDate, customEndDate, customEndTime, customStartDate, customStartTime, interval]);

  const loadStats = useCallback(async () => {
    setApplyError("");
    const range = buildRange();
    if (!range.ok) {
      setApplyError(range.error);
      return;
    }

      const params = new URLSearchParams({
        start: range.start,
        end: range.end,
        granularity: range.granularity,
        login: "all",
      });

    try {
      const [visitsRes, newUsersRes] = await Promise.all([
        fetch(`/api/admin/visits?${params.toString()}`),
        fetch(`/api/admin/new-users?${params.toString()}`),
      ]);

      if (visitsRes.status === 403 || newUsersRes.status === 403) {
        setError("Доступ только для администратора.");
        return;
      }

      const visits = await visitsRes.json();
      const newUsers = await newUsersRes.json();

      if (!visits.success || !newUsers.success) {
        setApplyError("Не удалось загрузить статистику.");
        return;
      }

      setGranularity(range.granularity);
      setVisitsData(visits.items || []);
      setNewUsersData(newUsers.items || []);
    } catch {
      setApplyError("Ошибка загрузки статистики.");
    }
  }, [buildRange]);

  useEffect(() => {
    const load = async () => {
      try {
        const authRes = await fetch("/api/auth");
        const auth = await authRes.json();
        if (!auth.authorized) {
          router.replace("/login");
          return;
        }

        const usersRes = await fetch("/api/admin/users");
        if (usersRes.status === 403) {
          setError("Доступ только для администратора.");
          return;
        }
        const usersData = await usersRes.json();
        if (usersData.success) {
          setUsers(usersData.items || []);
        }

        const storageRes = await fetch("/api/admin/storage");
        const storageData = await storageRes.json();
        if (storageData.success) {
          setStorage(storageData);
        }

        await loadStats();
      } catch {
        setError("Ошибка загрузки.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [loadStats, router]);

  return (
    <div
      className={`${grotesk.className} min-h-screen bg-zinc-950 text-zinc-100`}
      style={{
        backgroundImage:
          "radial-gradient(1200px 500px at 10% -10%, #0f766e 0%, transparent 60%), radial-gradient(900px 420px at 90% 0%, #f97316 0%, transparent 55%), linear-gradient(180deg, #09090b 0%, #0b1120 100%)",
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
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

        <main className="flex flex-1 flex-col gap-8 py-12">
          <div>
            <div className={`${mono.className} text-xs uppercase tracking-[0.3em] text-white/60`}>
              Панель администратора
            </div>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
              Статистика сервиса
            </h1>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {loading && !error ? (
            <div className="text-sm text-white/60">Загрузка...</div>
          ) : null}

          {!loading && !error ? (
            <>
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className={`${mono.className} text-xs uppercase tracking-[0.3em] text-white/50`}>
                  Настройки интервала
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    Интервал
                    <select
                      value={interval}
                      onChange={(event) =>
                        setInterval(event.target.value as typeof interval)
                      }
                      className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-white"
                    >
                      <option value="day">За день</option>
                      <option value="month">За месяц</option>
                      <option value="three_months">За три месяца</option>
                      <option value="custom">Настраиваемый</option>
                    </select>
                  </label>

                  {interval !== "custom" ? (
                    <CalendarInput
                      label="Дата конца интервала"
                      value={anchorDate}
                      onChange={setAnchorDate}
                    />
                  ) : (
                    <>
                      <CalendarInput
                        label="Начало (дата)"
                        value={customStartDate}
                        onChange={setCustomStartDate}
                      />
                      <label className="flex flex-col gap-2 text-sm text-white/70">
                        Начало (время)
                        <input
                          type="time"
                          value={customStartTime}
                          onChange={(event) => setCustomStartTime(event.target.value)}
                          className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-white"
                        />
                      </label>
                      <CalendarInput
                        label="Конец (дата)"
                        value={customEndDate}
                        onChange={setCustomEndDate}
                      />
                      <label className="flex flex-col gap-2 text-sm text-white/70">
                        Конец (время)
                        <input
                          type="time"
                          value={customEndTime}
                          onChange={(event) => setCustomEndTime(event.target.value)}
                          className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-white"
                        />
                      </label>
                    </>
                  )}
                </div>

                {applyError ? (
                  <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                    {applyError}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    onClick={loadStats}
                    className="rounded-full bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-900 transition hover:bg-zinc-200"
                  >
                    Применить
                  </button>
                  <span className="text-xs text-white/50">
                    Детализация: {granularity === "hour" ? "по часам" : "по дням"}
                  </span>
                </div>
              </section>

              <div className="grid gap-6 xl:grid-cols-2">
                <Chart
                  title="Посещения"
                  subtitle="Web и TG"
                  data={visitsData}
                  granularity={granularity}
                  accent="#38bdf8"
                />
                <Chart
                  title="Новые пользователи"
                  subtitle="Регистрации"
                  data={newUsersData}
                  granularity={granularity}
                  accent="#f97316"
                />
              </div>

              <section className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className={`${mono.className} text-xs text-white/60`}>
                    Пользователи
                  </div>
                  <div className="mt-2 text-3xl font-semibold">
                    {storage?.users_count ?? "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className={`${mono.className} text-xs text-white/60`}>
                    Данные пользователей, МБ
                  </div>
                  <div className="mt-2 text-3xl font-semibold">
                    {storage?.user_data_mb ?? "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className={`${mono.className} text-xs text-white/60`}>
                    Общий объем сервера, МБ
                  </div>
                  <div className="mt-2 text-3xl font-semibold">
                    {storage?.total_disk_mb ?? "—"}
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}











