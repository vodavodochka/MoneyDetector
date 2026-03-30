"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type HistoryItem = {
  id: string;
  filename: string;
  status: "PENDING" | "STARTED" | "SUCCESS" | "FAILURE";
  total?: number;
  imageUrl?: string;
  objects?: string[];
  objectsCount?: number;
  instances?: HistoryInstance[];
  error?: string;
  createdAt: string;
  completedAt?: string;
};

type HistoryInstance = {
  label?: string;
  image_url?: string;
  mask_score?: number | null;
  bbox?: number[] | null;
  bbox_mask_iou?: number | null;
};

const API_BASE = "/api";
const POLL_INTERVAL_MS = 1500;
const AUTO_REFRESH_INTERVAL_MS = 10000;
const STATUS_LABELS: Record<HistoryItem["status"], string> = {
  PENDING: "В очереди",
  STARTED: "В обработке",
  SUCCESS: "Готово",
  FAILURE: "Ошибка",
};

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isReadableFilename(name: string | undefined): boolean {
  if (!name || name.length > 80) return false;
  if (/^[A-Za-z0-9_-]{30,}$/.test(name)) return false;
  return /\.[A-Za-zА-Яа-я0-9]{2,6}$/.test(name);
}

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [isTopupLoading, setIsTopupLoading] = useState(false);
  const [topupNotice, setTopupNotice] = useState<string | null>(null);
  const [topupError, setTopupError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<{
    src: string;
    title: string;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const pollTimersRef = useRef<Record<string, number>>({});
  const enrichRequestsRef = useRef<Record<string, boolean>>({});
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth`);
        const data = await res.json();
        if (!data.authorized) {
          router.replace("/login");
          return;
        }
        setIsAuthed(true);
        fetchBalance();
        fetchHistory();
      } catch {
        router.replace("/login");
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    history
      .filter((item) => item.status !== "SUCCESS" && item.status !== "FAILURE")
      .forEach((item) => startPolling(item.id));
  }, [history]);

  useEffect(() => {
    if (!isAuthed) return;

    const intervalId = window.setInterval(() => {
      fetchHistory();
      fetchBalance();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchHistory();
        fetchBalance();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;

    const candidates = history.filter(
      (item) =>
        item.status === "SUCCESS" &&
        typeof item.objectsCount !== "number" &&
        (!item.objects || item.objects.length === 0) &&
        (!item.instances || item.instances.length === 0)
    );

    candidates.forEach((item) => {
      if (enrichRequestsRef.current[item.id]) return;
      enrichRequestsRef.current[item.id] = true;

      fetch(`${API_BASE}/result/${item.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.status !== "SUCCESS") {
            delete enrichRequestsRef.current[item.id];
            return;
          }
          const hasObjectsPayload =
            data.result &&
            (Array.isArray(data.result?.objects) ||
              Array.isArray(data.result?.instances) ||
              typeof toNumber(data.result?.objects_count) === "number");

          if (!hasObjectsPayload) {
            delete enrichRequestsRef.current[item.id];
            return;
          }
          updateHistory(item.id, {
            objects: Array.isArray(data.result?.objects) ? data.result.objects : [],
            objectsCount:
              toNumber(data.result?.objects_count) ??
              (Array.isArray(data.result?.instances)
                ? data.result.instances.length
                : 0),
            instances: Array.isArray(data.result?.instances)
              ? data.result.instances
              : [],
          });
        })
        .catch(() => {
          delete enrichRequestsRef.current[item.id];
        });
    });
  }, [history, isAuthed]);

  useEffect(() => {
    return () => {
      Object.values(pollTimersRef.current).forEach((timerId) =>
        clearTimeout(timerId)
      );
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function updateHistory(id: string, patch: Partial<HistoryItem>) {
    setHistory((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  async function pollResult(taskId: string) {
    try {
      const res = await fetch(`${API_BASE}/result/${taskId}`);
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();

      if (data.status === "SUCCESS") {
        updateHistory(taskId, {
          status: "SUCCESS",
          total: data.result?.total,
          imageUrl: data.result?.image_url,
          objects: Array.isArray(data.result?.objects) ? data.result.objects : [],
          objectsCount:
            toNumber(data.result?.objects_count) ??
            (Array.isArray(data.result?.instances)
              ? data.result.instances.length
              : undefined),
          instances: Array.isArray(data.result?.instances)
            ? data.result.instances
            : [],
          completedAt: new Date().toISOString(),
        });
        stopPolling(taskId);
        return;
      }

      if (data.status === "FAILURE") {
        updateHistory(taskId, {
          status: "FAILURE",
          error: data.error || "Неизвестная ошибка",
          completedAt: new Date().toISOString(),
        });
        stopPolling(taskId);
        return;
      }

      updateHistory(taskId, {
        status: data.status,
      });
    } catch (err) {
      updateHistory(taskId, {
        status: "FAILURE",
        error: err instanceof Error ? err.message : "Запрос завершился ошибкой",
        completedAt: new Date().toISOString(),
      });
      stopPolling(taskId);
      return;
    }

    scheduleNextPoll(taskId);
  }

  function scheduleNextPoll(taskId: string) {
    const timerId = window.setTimeout(() => {
      pollResult(taskId);
    }, POLL_INTERVAL_MS);
    pollTimersRef.current[taskId] = timerId;
  }

  function startPolling(taskId: string) {
    if (pollTimersRef.current[taskId]) return;
    pollResult(taskId);
  }

  function stopPolling(taskId: string) {
    const timerId = pollTimersRef.current[taskId];
    if (timerId) {
      clearTimeout(timerId);
      delete pollTimersRef.current[taskId];
    }
  }

  async function handleUpload() {
    if (!file || isUploading) return;

    setIsUploading(true);

    const formData = new FormData();
    formData.append("image", file);

    try {
      const res = await fetch(`${API_BASE}/detect`, {
        method: "POST",
        body: formData,
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }

      const data = await res.json();

      const newItem: HistoryItem = {
        id: data.task_id,
        filename: file.name,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };

      setHistory((prev) => [newItem, ...prev]);
      setFile(null);
      startPolling(data.task_id);
    } finally {
      setIsUploading(false);
    }
  }

  const hasHistory = history.length > 0;

  async function fetchHistory() {
    try {
      const res = await fetch(`${API_BASE}/history`);
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        setHistory((prev) => {
          const prevById = new Map(prev.map((entry) => [entry.id, entry]));
          return data.items.map((item: HistoryItem & { objects_count?: unknown }) => {
            const prevItem = prevById.get(item.id);
            const hasObjects = Object.prototype.hasOwnProperty.call(item, "objects");
            const hasInstances = Object.prototype.hasOwnProperty.call(item, "instances");
            const hasObjectsCount =
              Object.prototype.hasOwnProperty.call(item, "objectsCount") ||
              Object.prototype.hasOwnProperty.call(item, "objects_count");

            return {
              ...item,
              createdAt:
                item.createdAt ??
                prevItem?.createdAt ??
                new Date().toISOString(),
              objects: hasObjects
                ? Array.isArray(item.objects)
                  ? item.objects
                  : []
                : prevItem?.objects ?? [],
              objectsCount: hasObjectsCount
                ? toNumber(item.objectsCount) ??
                  toNumber(item.objects_count) ??
                  (Array.isArray(item.instances) ? item.instances.length : 0)
                : prevItem?.objectsCount,
              instances: hasInstances
                ? Array.isArray(item.instances)
                  ? item.instances
                  : []
                : prevItem?.instances ?? [],
            };
          });
        });
      }
    } catch {
      // ignore history load errors for now
    }
  }

  async function fetchBalance() {
    try {
      const res = await fetch(`${API_BASE}/balance`);
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      if (data.success) {
        setBalance(data.balance);
        setCost(data.cost);
      }
    } catch {
      // ignore balance errors
    }
  }

  async function handleTopup() {
    if (isTopupLoading) return;

    const amount = Number.parseInt(topupAmount.trim(), 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopupError("Введите корректную сумму пополнения.");
      setTopupNotice(null);
      return;
    }

    setIsTopupLoading(true);
    setTopupError(null);
    setTopupNotice(null);

    try {
      const res = await fetch(`${API_BASE}/balance/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }

      const data = await res.json();
      if (data.success) {
        setBalance((prev) =>
          typeof data.balance === "number" ? data.balance : prev
        );
        setTopupNotice(`Баланс пополнен на ${amount} токенов.`);
        setTopupAmount("");
        setIsTopupModalOpen(false);
        fetchBalance();
        return;
      }

      const errorText =
        (typeof data.detail === "string" && data.detail) ||
        (typeof data.message === "string" && data.message) ||
        (typeof data.error === "string" && data.error) ||
        "Не удалось пополнить баланс.";
      setTopupError(errorText);
    } catch {
      setTopupError("Не удалось пополнить баланс.");
    } finally {
      setIsTopupLoading(false);
    }
  }

  function handleLogout() {
    fetch(`${API_BASE}/logout`, { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  const analysisNumberMap = useMemo(() => {
    const sorted = [...history].sort((a, b) => {
      const left = Date.parse(a.createdAt || "");
      const right = Date.parse(b.createdAt || "");
      return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
    });
    const map = new Map<string, number>();
    sorted.forEach((item, idx) => {
      map.set(item.id, idx + 1);
    });
    return map;
  }, [history]);

  function getAnalysisTitle(item: HistoryItem, fallbackIndex?: number) {
    const number =
      analysisNumberMap.get(item.id) ??
      (typeof fallbackIndex === "number" ? fallbackIndex + 1 : 1);
    return `Анализ #${number}`;
  }

  function getLocalizedStatus(status: HistoryItem["status"]) {
    return STATUS_LABELS[status] ?? status;
  }

  function getObjectsCount(item: HistoryItem) {
    if (Array.isArray(item.instances) && item.instances.length > 0) {
      return item.instances.length;
    }
    if (typeof item.objectsCount === "number") return item.objectsCount;
    if (Array.isArray(item.instances)) return item.instances.length;
    if (Array.isArray(item.objects)) return item.objects.length;
    return 0;
  }

  function getObjectLabels(item: HistoryItem) {
    if (Array.isArray(item.instances) && item.instances.length > 0) {
      const labels: string[] = [];
      const seen = new Set<string>();
      item.instances.forEach((instance) => {
        const raw = instance?.label;
        if (typeof raw !== "string") return;
        const label = raw.trim();
        if (!label || seen.has(label)) return;
        seen.add(label);
        labels.push(label);
      });
      if (labels.length > 0) return labels;
    }

    if (!Array.isArray(item.objects)) return [];
    return item.objects
      .filter((obj): obj is string => typeof obj === "string")
      .map((obj) => obj.trim())
      .filter((obj) => obj.length > 0);
  }

  const previewItems = history
    .filter((item) => item.imageUrl)
    .map((item) => ({
      src: `${API_BASE}${item.imageUrl}`,
      title: getAnalysisTitle(item),
    }));

  useEffect(() => {
    if (!activeImage) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveImage(null);
        setActiveIndex(null);
        return;
      }
      if (event.key === "ArrowRight") {
        if (activeIndex === null) return;
        const next = (activeIndex + 1) % previewItems.length;
        setActiveIndex(next);
        setActiveImage(previewItems[next]);
      }
      if (event.key === "ArrowLeft") {
        if (activeIndex === null) return;
        const prev =
          (activeIndex - 1 + previewItems.length) % previewItems.length;
        setActiveIndex(prev);
        setActiveImage(previewItems[prev]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeImage, activeIndex, previewItems]);

  return (
    !isAuthed ? null : (
    <div
      className={`${grotesk.className} min-h-screen bg-zinc-950 text-zinc-100`}
      style={{
        backgroundImage:
          "radial-gradient(1200px 500px at 10% -10%, #1d4ed8 0%, transparent 60%), radial-gradient(900px 420px at 90% 0%, #f97316 0%, transparent 55%), linear-gradient(180deg, #09090b 0%, #0f172a 100%)",
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            CoinDetector
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-widest backdrop-blur transition hover:border-white/50 hover:bg-white/20"
            >
              Главная
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-widest backdrop-blur transition hover:border-white/50 hover:bg-white/20"
            >
              Выйти
            </button>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-10 py-12">
          <section className="flex flex-col gap-4">
            <div
              className={`${mono.className} text-xs uppercase tracking-[0.3em] text-white/60`}
            >
              Загрузка · Очередь · Результат
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Кошелек</div>
              <div className={`${mono.className} text-xs text-white/60`}>
                Автообновление каждые 10 сек
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                <div className="text-xs uppercase tracking-widest text-white/60">
                  Доступно
                </div>
                <div className="mt-1 text-3xl font-semibold text-white">
                  {balance ?? "—"} токенов
                </div>
                <div className="mt-2 text-xs text-white/60">
                  Стоимость 1 анализа: {cost ?? "—"} токенов
                </div>
              </div>
              <button
                className="self-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white/90"
                onClick={() => {
                  setTopupError(null);
                  setTopupNotice(null);
                  setIsTopupModalOpen(true);
                }}
              >
                Пополнить кошелек
              </button>
            </div>
            {topupNotice ? (
              <div className="mt-3 text-sm text-emerald-200">{topupNotice}</div>
            ) : null}
            {topupError ? (
              <div className="mt-3 text-sm text-red-200">{topupError}</div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="text-lg font-semibold">Загрузить изображение</div>
            <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-200/10 p-3 text-sm text-amber-100">
              ⚠️ Если на фото видно меньше 80% монеты или купюры, сервис не гарантирует корректный подсчет.
            </div>

            <div className="mt-4 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div
                className={`rounded-2xl border border-dashed p-6 transition ${
                  isDragOver
                    ? "border-white/70 bg-white/10"
                    : "border-white/25 bg-white/5"
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <div className="text-sm text-white/70">
                  Перетащите изображение сюда или выберите файл вручную.
                </div>
                <input
                  type="file"
                  className="mt-4 w-full text-sm text-white/80 file:mr-4 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-widest file:text-white/80 file:transition hover:file:bg-white/20"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <button
                  className="mt-4 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleUpload}
                  disabled={!file || isUploading}
                >
                  {isUploading
                    ? "Загрузка..."
                    : `Отправить на анализ${cost ? ` (-${cost})` : ""}`}
                </button>
                <div className="mt-2 text-xs text-white/60">
                  Задача обрабатывается в фоновом режиме.
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm text-white/70">Предпросмотр</div>
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Предпросмотр"
                    className="mt-3 w-full rounded-xl border border-white/10 object-cover"
                  />
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-xs text-white/50">
                    Пока нет изображения
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">История</div>
              <div className={`${mono.className} text-xs text-white/50`}>
                {hasHistory ? `${history.length} анализов` : "Нет записей"}
              </div>
            </div>

            {!hasHistory ? (
              <div className="mt-6 text-sm text-white/60">
                История пустая. Загрузите фото, чтобы увидеть статус и итог.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {history.map((item, index) => {
                  const analysisTitle = getAnalysisTitle(item, index);
                  const objectCount = getObjectsCount(item);
                  const objects = getObjectLabels(item);
                  const instances = Array.isArray(item.instances) ? item.instances : [];
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{analysisTitle}</div>
                          {isReadableFilename(item.filename) ? (
                            <div className="mt-1 text-xs text-white/50">
                              {item.filename}
                            </div>
                          ) : null}
                        </div>
                        <div
                          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${
                            item.status === "SUCCESS"
                              ? "bg-emerald-500/20 text-emerald-200"
                              : item.status === "FAILURE"
                              ? "bg-red-500/20 text-red-200"
                              : "bg-white/10 text-white/70"
                          }`}
                        >
                          {getLocalizedStatus(item.status)}
                        </div>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-white/60">
                        <div>ID задачи: {item.id}</div>
                        <div>Начало: {new Date(item.createdAt).toLocaleString("ru-RU")}</div>
                        {item.completedAt ? (
                          <div>
                            Завершено: {new Date(item.completedAt).toLocaleString("ru-RU")}
                          </div>
                        ) : null}
                      </div>
                      {item.status === "SUCCESS" ? (
                        <div className="mt-3 flex flex-col gap-3">
                          <div className="text-base font-semibold text-white">
                            Сумма: {item.total ?? 0}
                          </div>
                          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                            <div className="text-xs uppercase tracking-widest text-white/60">
                              Детекция объектов
                            </div>
                            <div className="mt-2 text-xs text-white/70">
                              Найдено объектов: {objectCount}
                            </div>
                            {objectCount === 0 ? (
                              <div className="mt-2 text-xs text-white/60">
                                На этом изображении объекты не обнаружены.
                              </div>
                            ) : null}
                            {objects.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {objects.map((obj) => (
                                  <span
                                    key={`${item.id}-${obj}`}
                                    className="rounded-full border border-white/20 px-2 py-1 text-xs text-white/80"
                                  >
                                    {obj}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {instances.length > 0 ? (
                              <div className="mt-3 grid grid-cols-4 gap-2">
                                {instances.slice(0, 8).map((instance, instanceIndex) => (
                                  <button
                                    key={`${item.id}-instance-${instanceIndex}`}
                                    className="overflow-hidden rounded-lg border border-white/10 bg-black/30 transition hover:border-white/30"
                                    onClick={() => {
                                      if (!instance.image_url) return;
                                      setActiveIndex(null);
                                      setActiveImage({
                                        src: `${API_BASE}${instance.image_url}`,
                                        title: `${analysisTitle} · ${instance.label || "Объект"} #${
                                          instanceIndex + 1
                                        }`,
                                      });
                                    }}
                                  >
                                    {instance.image_url ? (
                                      <img
                                        src={`${API_BASE}${instance.image_url}`}
                                        alt={instance.label || "Объект"}
                                        className="h-16 w-full object-cover"
                                      />
                                    ) : (
                                      <div className="h-16 w-full bg-white/5" />
                                    )}
                                    <div className="truncate px-2 py-1 text-[10px] text-white/70">
                                      {instance.label || "объект"}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {item.imageUrl ? (
                            <button
                              className="group relative h-28 w-full overflow-hidden rounded-xl border border-white/10 bg-black/20"
                              onClick={() =>
                                (() => {
                                  const activeImageSrc = `${API_BASE}${item.imageUrl}`;
                                  const imageIndex = previewItems.findIndex(
                                    (entry) => entry.src === activeImageSrc
                                  );
                                  setActiveIndex(imageIndex >= 0 ? imageIndex : null);
                                  setActiveImage({
                                    src: activeImageSrc,
                                    title: analysisTitle,
                                  });
                                })()
                              }
                            >
                              <img
                                src={`${API_BASE}${item.imageUrl}`}
                                alt={`Превью результата ${analysisTitle}`}
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                              />
                              <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-2 text-xs text-white/80">
                                <span>Превью</span>
                                <span>Открыть</span>
                              </div>
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {item.status === "FAILURE" ? (
                        <div className="mt-3 text-sm text-red-200">
                          Ошибка: {item.error}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>

      {isTopupModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => {
            if (isTopupLoading) return;
            setIsTopupModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-xl font-semibold text-white">Пополнение кошелька</h3>
            <p className="mt-2 text-sm text-white/70">
              Введите сумму токенов, на которую хотите пополнить баланс.
            </p>
            <input
              type="number"
              min={1}
              step={1}
              value={topupAmount}
              onChange={(event) => setTopupAmount(event.target.value)}
              placeholder="Например, 100"
              className="mt-4 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
            />
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white"
                onClick={() => setIsTopupModalOpen(false)}
                disabled={isTopupLoading}
              >
                Отмена
              </button>
              <button
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleTopup}
                disabled={isTopupLoading}
              >
                {isTopupLoading ? "Пополняем..." : "Пополнить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeImage ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
          onClick={() => {
            setActiveImage(null);
            setActiveIndex(null);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between text-sm text-white/70">
              <div>{activeImage.title}</div>
              <div className="flex items-center gap-2">
                {activeIndex !== null && previewItems.length > 0 ? (
                  <>
                    <button
                      className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-widest text-white/70 hover:text-white"
                      onClick={() => {
                        if (activeIndex === null || previewItems.length === 0) {
                          return;
                        }
                        const prev =
                          (activeIndex - 1 + previewItems.length) %
                          previewItems.length;
                        setActiveIndex(prev);
                        setActiveImage(previewItems[prev]);
                      }}
                    >
                      Назад
                    </button>
                    <button
                      className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-widest text-white/70 hover:text-white"
                      onClick={() => {
                        if (activeIndex === null || previewItems.length === 0) {
                          return;
                        }
                        const next = (activeIndex + 1) % previewItems.length;
                        setActiveIndex(next);
                        setActiveImage(previewItems[next]);
                      }}
                    >
                      Далее
                    </button>
                  </>
                ) : null}
                <button
                  className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-widest text-white/70 hover:text-white"
                  onClick={() => {
                    setActiveImage(null);
                    setActiveIndex(null);
                  }}
                >
                  Закрыть
                </button>
              </div>
            </div>
            <img
              src={activeImage.src}
              alt={activeImage.title}
              className="max-h-[80vh] w-full rounded-2xl border border-white/10 object-contain"
            />
          </div>
        </div>
      ) : null}
    </div>
    )
  );
}
