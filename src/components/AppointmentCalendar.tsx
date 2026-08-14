import { useState, useMemo, useCallback, useRef, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────

export interface Appointment {
  id: string;
  title: string;
  clientName?: string;
  date: string; // ISO date string (e.g. "2026-08-15")
  time?: string;
  status: "confirmed" | "pending" | "cancelled";
}

interface AppointmentCalendarProps {
  appointments: Appointment[];
  className?: string;
}

// ─── Status badge config ──────────────────────────────────────────────

const STATUS_STYLES: Record<Appointment["status"], string> = {
  confirmed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
  cancelled:
    "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
};

const STATUS_DOT: Record<Appointment["status"], string> = {
  confirmed: "bg-emerald-500",
  pending: "bg-amber-500",
  cancelled: "bg-red-400",
};

// ─── Constants ────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── Helpers ──────────────────────────────────────────────────────────

function isoDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return isoDateString(d.getFullYear(), d.getMonth(), d.getDate());
}

function isToday(year: number, month: number, day: number): boolean {
  return isoDateString(year, month, day) === todayISO();
}

/**
 * Build the calendar matrix for a given month.
 * Returns an array of weeks; each week is an array of 7 day entries.
 * A day entry is `{ day, iso }` for in-month days or `null` for padding.
 */
function buildCalendar(
  year: number,
  month: number,
): (null | { day: number; iso: string })[][] {
  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const matrix: (null | { day: number; iso: string })[][] = [];
  let week: (null | { day: number; iso: string })[] = [];

  // Leading empty cells
  for (let i = 0; i < startDay; i++) {
    week.push(null);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    week.push({ day: d, iso: isoDateString(year, month, d) });
    if (week.length === 7) {
      matrix.push(week);
      week = [];
    }
  }

  // Trailing empty cells
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    matrix.push(week);
  }

  return matrix;
}

// ─── Component ────────────────────────────────────────────────────────

export default function AppointmentCalendar({
  appointments,
  className = "",
}: AppointmentCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0‑based
  const [selectedISO, setSelectedISO] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Detect mobile for responsive rendering
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Collapse panel on month change
  useEffect(() => {
    setSelectedISO(null);
  }, [viewYear, viewMonth]);

  // Click‑outside to close panel
  useEffect(() => {
    if (!selectedISO) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setSelectedISO(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectedISO]);

  // Group appointments by date for fast lookup
  const byDate = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const a of appointments) {
      const dateKey = a.date.slice(0, 10); // "YYYY-MM-DD"
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(a);
    }
    return map;
  }, [appointments]);

  const calendar = useMemo(
    () => buildCalendar(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const selectedAppts = selectedISO ? byDate[selectedISO] || [] : [];

  // Navigation
  const goPrev = useCallback(() => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [viewMonth]);

  const goNext = useCallback(() => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [viewMonth]);

  const goToday = useCallback(() => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedISO(todayISO());
  }, []);

  // Count appointments this month
  const monthApptCount = useMemo(() => {
    const prefix = isoDateString(viewYear, viewMonth, 0).slice(0, 7); // "YYYY-MM"
    return appointments.filter((a) => a.date.startsWith(prefix)).length;
  }, [appointments, viewYear, viewMonth]);

  // ── Mobile: Agenda / list view ────────────────────────────────────
  if (isMobile) {
    return (
      <div
        className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm ${className}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold tracking-tight">
            📅 {MONTH_NAMES[viewMonth]} {viewYear}
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={goPrev}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              aria-label="Previous month"
            >
              ←
            </button>
            <button
              onClick={goToday}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={goNext}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              aria-label="Next month"
            >
              →
            </button>
          </div>
        </div>

        {/* Appointment list grouped by date */}
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {Object.keys(byDate)
            .filter((d) => d.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`))
            .sort()
            .length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <span className="text-4xl mb-3">📅</span>
              <p className="text-sm font-medium">No appointments this month</p>
              <p className="text-xs mt-1">Your schedule is clear!</p>
            </div>
          ) : (
            Object.keys(byDate)
              .filter((d) => d.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`))
              .sort()
              .map((dateKey) => {
                const appts = byDate[dateKey];
                const dayNum = parseInt(dateKey.slice(8, 10), 10);
                const dayName = new Date(dateKey).toLocaleDateString("en-US", {
                  weekday: "short",
                });
                const highlightToday =
                  dateKey === todayISO()
                    ? "border-l-4 border-l-indigo-500 pl-4"
                    : "border-l-4 border-l-transparent pl-4";

                return (
                  <div
                    key={dateKey}
                    className={`py-3 px-5 ${highlightToday}`}
                  >
                    <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2">
                      {dayName}, {MONTH_NAMES[viewMonth].slice(0, 3)} {dayNum}
                    </p>
                    <div className="space-y-2">
                      {appts.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {a.title}
                            </p>
                            <p className="text-xs text-gray-400">
                              {a.clientName || "—"}
                              {a.time && ` · ${a.time}`}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[a.status]}`}
                          >
                            {a.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>
    );
  }

  // ── Desktop: calendar grid ─────────────────────────────────────────
  return (
    <div
      className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm ${className}`}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h2>
          <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
            {monthApptCount} appointment{monthApptCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={goPrev}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            aria-label="Previous month"
          >
            ←
          </button>
          <button
            onClick={goToday}
            className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={goNext}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            aria-label="Next month"
          >
            →
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="p-4">
        {/* Day‑of‑week headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              className="text-center text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 py-2"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid with transition */}
        <div
          key={`${viewYear}-${viewMonth}`}
          className="animate-[fp-calendar-in_250ms_ease-out]"
        >
          <style>{`
            @keyframes fp-calendar-in {
              from { opacity: 0; transform: translateY(6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          {calendar.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((cell, ci) => {
                if (!cell) {
                  return (
                    <div
                      key={`empty-${ci}`}
                      className="aspect-square p-1"
                    />
                  );
                }

                const { day, iso } = cell;
                const appts = byDate[iso] || [];
                const isTodayCell = isToday(viewYear, viewMonth, day);
                const isSelected = selectedISO === iso;

                return (
                  <div key={iso} className="aspect-square p-1">
                    <button
                      onClick={() =>
                        setSelectedISO(isSelected ? null : iso)
                      }
                      className={`relative flex h-full w-full flex-col items-center justify-start rounded-xl pt-1.5 text-sm font-medium transition-all duration-150 cursor-pointer
                        ${isSelected
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25 ring-2 ring-indigo-600"
                          : isTodayCell
                            ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-800"
                            : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                        }
                      `}
                    >
                      <span
                        className={
                          isTodayCell && !isSelected
                            ? "font-extrabold"
                            : "font-medium"
                        }
                      >
                        {day}
                      </span>

                      {/* Appointment dots */}
                      {appts.length > 0 && (
                        <div className="flex items-center gap-0.5 mt-1">
                          {appts.slice(0, 3).map((a) => (
                            <span
                              key={a.id}
                              className={`block h-1.5 w-1.5 rounded-full ${
                                isSelected
                                  ? "bg-white"
                                  : STATUS_DOT[a.status]
                              }`}
                            />
                          ))}
                          {appts.length > 3 && (
                            <span
                              className={`text-[9px] leading-none font-semibold ${
                                isSelected
                                  ? "text-white"
                                  : "text-gray-400 dark:text-gray-500"
                              }`}
                            >
                              +{appts.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Empty state for month with zero appointments */}
          {monthApptCount === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400 mt-2 border-t border-gray-100 dark:border-gray-800">
              <span className="text-3xl mb-2">📅</span>
              <p className="text-sm font-medium">No appointments this month</p>
              <p className="text-xs mt-0.5">Your schedule is clear!</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Side panel ───────────────────────────────────────────────── */}
      {selectedISO && selectedAppts.length > 0 && (
        <div
          ref={panelRef}
          className="border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 rounded-b-xl animate-[fp-panel-in_200ms_ease-out]"
        >
          <style>{`
            @keyframes fp-panel-in {
              from { opacity: 0; max-height: 0; }
              to   { opacity: 1; max-height: 400px; }
            }
          `}</style>

          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold tracking-tight text-gray-700 dark:text-gray-200">
                {new Date(selectedISO).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h3>
              <span className="text-xs text-gray-400 bg-gray-200/70 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                {selectedAppts.length} appointment{selectedAppts.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="space-y-2">
              {selectedAppts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-4 py-3 hover:shadow-sm transition-shadow"
                >
                  {/* Color swatch */}
                  <div
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      STATUS_DOT[a.status]
                    }`}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {a.clientName || "No client name"}
                      {a.time && (
                        <>
                          <span className="mx-1.5">·</span>
                          {a.time}
                        </>
                      )}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_STYLES[a.status]}`}
                  >
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
