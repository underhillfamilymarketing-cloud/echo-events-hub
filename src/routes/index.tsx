import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  LockKeyhole,
  LogOut,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchEventsInRange, fetchUpcomingEvents, searchEvents, type EventRow } from "@/lib/events";
import { PROJECTS, getProject } from "@/lib/projects";
import {
  daysInMonth,
  formatLongDate,
  monthLabel,
  todayISO,
  toISO,
  formatTime,
} from "@/lib/date-utils";
import { DayRow } from "@/components/DayRow";
import { MonthGrid } from "@/components/MonthGrid";
import { ProjectFilter } from "@/components/ProjectFilter";
import { EventSheet } from "@/components/EventSheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ECHO Events — спільний календар подій агенції" },
      {
        name: "description",
        content:
          "Спільний календар подій ECHO Marketing: додавайте, редагуйте та шукайте події по проєктах із будь-якого пристрою.",
      },
      { property: "og:title", content: "ECHO Events — спільний календар подій" },
      {
        property: "og:description",
        content: "Календар подій агенції ECHO Marketing з фільтрами за проєктами та пошуком.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EchoEvents,
});

type Tab = "calendar" | "search" | "upcoming";

const ACCESS_PASSWORD = "1234";
const DAY_END_MINUTES = 24 * 60;

function eventTimeMinutes(event: EventRow): number {
  if (!event.event_time) return DAY_END_MINUTES;
  const [hours = "0", minutes = "0"] = event.event_time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function compareEventsByStart(a: EventRow, b: EventRow) {
  const byDate = a.event_date.localeCompare(b.event_date);
  if (byDate !== 0) return byDate;
  return eventTimeMinutes(a) - eventTimeMinutes(b);
}

function isUpcomingEvent(event: EventRow, now: Date, today: string) {
  if (event.event_date > today) return true;
  if (event.event_date < today) return false;
  if (!event.event_time) return true;
  return eventTimeMinutes(event) >= now.getHours() * 60 + now.getMinutes();
}

function EchoEvents() {
  const qc = useQueryClient();
  const today = todayISO();
  const now = new Date();

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [view, setView] = useState<"days" | "grid">("days");
  const [tab, setTab] = useState<Tab>("calendar");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDate, setSheetDate] = useState(today);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [introVisible, setIntroVisible] = useState(true);

  const days = useMemo(() => daysInMonth(year, month), [year, month]);
  const rangeFrom = days[0] ?? today;
  const rangeTo = days[days.length - 1] ?? today;

  const monthQuery = useQuery({
    queryKey: ["events", rangeFrom, rangeTo],
    queryFn: () => fetchEventsInRange(rangeFrom, rangeTo),
  });

  const upcomingQuery = useQuery({
    queryKey: ["events-upcoming", today],
    queryFn: () => fetchUpcomingEvents(today, 20),
  });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(t);
  }, [term]);

  const searchQuery = useQuery({
    queryKey: ["events-search", debounced],
    queryFn: () => searchEvents(debounced),
    enabled: debounced.trim().length > 1,
  });

  useEffect(() => {
    const channel = supabase
      .channel("events-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        void qc.invalidateQueries();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setIntroVisible(false), 5000);
    return () => window.clearTimeout(timeout);
  }, []);

  const matchesProject = (e: EventRow) =>
    selectedProjects.length === 0 || selectedProjects.includes(e.project);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of monthQuery.data ?? []) {
      if (!matchesProject(e)) continue;
      const list = map.get(e.event_date) ?? [];
      list.push(e);
      map.set(e.event_date, list);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthQuery.data, selectedProjects]);

  const searchResults = useMemo(() => {
    const projectMatches = PROJECTS.filter((p) =>
      p.name.toLowerCase().includes(debounced.trim().toLowerCase()),
    ).map((p) => p.id);
    const base = searchQuery.data ?? [];
    const extra = (upcomingQuery.data ?? []).filter((e) => projectMatches.includes(e.project));
    const merged = [...base, ...extra].filter(
      (e, i, arr) => arr.findIndex((x) => x.id === e.id) === i,
    );
    return merged.filter(matchesProject).sort(compareEventsByStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery.data, upcomingQuery.data, debounced, selectedProjects]);

  const upcoming = useMemo(
    () =>
      (upcomingQuery.data ?? [])
        .filter(matchesProject)
        .filter((event) => isUpcomingEvent(event, now, today))
        .sort(compareEventsByStart),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upcomingQuery.data, selectedProjects, today],
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const goToday = () => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setTab("calendar");
    setView("days");
    setTimeout(() => {
      document.getElementById(`day-${toISO(d)}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 120);
  };

  const openAdd = (iso: string) => {
    if (!isAuthorized) {
      setAuthOpen(true);
      return;
    }
    setEditing(null);
    setSheetDate(iso);
    setSheetOpen(true);
  };

  const openEdit = (event: EventRow) => {
    if (!isAuthorized) {
      setAuthOpen(true);
      return;
    }
    setEditing(event);
    setSheetDate(event.event_date);
    setSheetOpen(true);
  };

  const toggleProject = (id: string) =>
    setSelectedProjects((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );

  const handleAuthorized = () => {
    setIsAuthorized(true);
    setAuthOpen(false);
  };

  const handleLogout = () => {
    setIsAuthorized(false);
    setTerm("");
    setDebounced("");
    setTab("calendar");
    setSheetOpen(false);
    setFiltersOpen(false);
  };

  return (
    <div className="app-shell-bg mobile-shell min-h-screen bg-background">
      <div className="site-frame mx-auto flex w-full max-w-7xl lg:gap-6 lg:px-6 lg:py-6">
        {/* Desktop sidebar */}
        <aside className="hidden w-80 shrink-0 flex-col gap-4 lg:flex">
          <div className="surface-card rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
            <BrandLockup size="desktop" />
            <p className="mt-3 text-sm text-muted-foreground">
              Спільний календар подій агенції. Зміни бачать усі, миттєво.
            </p>
            {isAuthorized && (
              <button
                type="button"
                onClick={() => {
                  if (isAuthorized) {
                    openAdd(today);
                    return;
                  }
                  setAuthOpen(true);
                }}
                className="gradient-bg mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl font-bold text-primary-foreground shadow-glow"
              >
                <Plus className="size-5" /> Нова подія
              </button>
            )}
          </div>

          <div className="surface-card rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
            <p className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Проєкти
            </p>
            <ProjectFilter
              vertical
              selected={selectedProjects}
              onToggle={toggleProject}
              onReset={() => setSelectedProjects([])}
            />
          </div>

          <div className="surface-card rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
            <p className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-4" /> Найближчі
            </p>
            <UpcomingList events={upcoming.slice(0, 8)} onOpen={openEdit} />
          </div>
        </aside>

        {/* Main */}
        <main className="mobile-main min-w-0 flex-1 pb-32 lg:pb-0">
          <header className="calendar-topbar mobile-header sticky top-0 z-30 border-b border-border/60 bg-background/85 px-4 pt-safe backdrop-blur-xl lg:static lg:rounded-2xl lg:border lg:bg-card lg:px-5 lg:shadow-soft">
            <div className="mobile-toolbar-row flex items-center justify-between gap-3 py-3">
              <BrandLockup size="mobile" className="lg:hidden" />
              <div className="hidden lg:block">
                <h1 className="font-display text-2xl font-bold">
                  <span className="gradient-text">ECHO</span> Events
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isAuthorized ? "Режим редагування" : "Режим перегляду"}
                </p>
              </div>
              <div className="mobile-actions flex items-center gap-2">
                <span
                  className={cn(
                    "mode-pill hidden rounded-full px-3 py-2 text-xs font-bold uppercase lg:inline-flex",
                    isAuthorized ? "mode-pill-edit" : "mode-pill-view",
                  )}
                >
                  {isAuthorized ? "Редагування" : "Перегляд"}
                </span>
                <button
                  type="button"
                  onClick={isAuthorized ? handleLogout : () => setAuthOpen(true)}
                  className={cn(
                    "top-action flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold lg:bg-elevated",
                    !isAuthorized ? "edit-cta border-transparent text-primary-foreground" : "",
                  )}
                >
                  {isAuthorized ? (
                    <>
                      <LogOut className="size-4" /> Вийти
                    </>
                  ) : (
                    <>
                      <LockKeyhole className="size-4" /> Редагувати
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={goToday}
                  className="today-button top-action rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold lg:bg-elevated"
                >
                  Сьогодні
                </button>
                <div className="view-switch top-action flex rounded-full border border-border bg-card p-1 lg:bg-elevated">
                  <button
                    type="button"
                    onClick={() => setView("days")}
                    aria-label="Режим по днях"
                    className={cn(
                      "grid size-8 place-items-center rounded-full",
                      view === "days" ? "gradient-bg text-primary-foreground" : "",
                    )}
                  >
                    <List className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("grid")}
                    aria-label="Режим сітки"
                    className={cn(
                      "grid size-8 place-items-center rounded-full",
                      view === "grid" ? "gradient-bg text-primary-foreground" : "",
                    )}
                  >
                    <LayoutGrid className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="month-strip mobile-month-strip flex items-center justify-between gap-2 pb-3">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Попередній місяць"
                className="month-nav-button grid size-10 place-items-center rounded-xl bg-card lg:bg-elevated"
              >
                <ChevronLeft className="size-5" />
              </button>
              <h2 className="font-display text-xl font-bold lg:text-2xl">
                {monthLabel(year, month)}
              </h2>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Наступний місяць"
                className="month-nav-button grid size-10 place-items-center rounded-xl bg-card lg:bg-elevated"
              >
                <ChevronRight className="size-5" />
              </button>
            </div>

            <div className="hidden pb-3 lg:block">
              <SearchInput value={term} onChange={setTerm} onFocusTab={() => setTab("search")} />
            </div>

            <div className="lg:hidden">
              <ProjectFilter
                selected={selectedProjects}
                onToggle={toggleProject}
                onReset={() => setSelectedProjects([])}
              />
            </div>
          </header>

          <div className="calendar-content mobile-calendar-content px-4 pt-4 lg:px-0">
            {tab === "search" || (term.trim().length > 1 && tab !== "upcoming") ? (
              <div className="flex flex-col gap-3">
                <div className="lg:hidden">
                  <SearchInput
                    value={term}
                    onChange={setTerm}
                    onFocusTab={() => setTab("search")}
                  />
                </div>
                {debounced.trim().length < 2 ? (
                  <EmptyState text="Введіть щонайменше 2 символи для пошуку" />
                ) : searchResults.length === 0 ? (
                  <EmptyState text="Нічого не знайдено" />
                ) : (
                  searchResults.map((e) => (
                    <ResultRow key={e.id} event={e} onOpen={() => openEdit(e)} />
                  ))
                )}
              </div>
            ) : tab === "upcoming" ? (
              <div className="flex flex-col gap-3">
                {upcoming.length === 0 ? (
                  <EmptyState text="Найближчих подій немає" />
                ) : (
                  upcoming.map((e) => <ResultRow key={e.id} event={e} onOpen={() => openEdit(e)} />)
                )}
              </div>
            ) : view === "days" ? (
              <div className="flex flex-col gap-2.5">
                {days.map((iso) => (
                  <DayRow
                    key={iso}
                    iso={iso}
                    events={eventsByDay.get(iso) ?? []}
                    isToday={iso === today}
                    canEdit={isAuthorized}
                    onAdd={openAdd}
                    onOpen={openEdit}
                  />
                ))}
              </div>
            ) : (
              <MonthGrid
                year={year}
                month={month}
                eventsByDay={eventsByDay}
                todayIso={today}
                canEdit={isAuthorized}
                onSelectDay={openAdd}
              />
            )}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/95 pb-safe backdrop-blur-xl lg:hidden">
        <div className="mobile-bottom-nav-grid grid grid-cols-5 items-center px-2">
          <NavButton
            active={tab === "calendar" && term.trim().length < 2}
            icon={<CalendarDays className="size-5" />}
            label="Календар"
            onClick={() => {
              setTerm("");
              setTab("calendar");
            }}
          />
          <NavButton
            active={tab === "search"}
            icon={<Search className="size-5" />}
            label="Пошук"
            onClick={() => setTab("search")}
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => openAdd(today)}
              aria-label="Додати подію"
              className="mobile-fab gradient-bg -mt-6 grid size-16 place-items-center rounded-full text-primary-foreground shadow-glow transition-transform active:scale-95"
            >
              {isAuthorized ? <Plus className="size-7" /> : <LockKeyhole className="size-7" />}
            </button>
          </div>
          <NavButton
            active={tab === "upcoming"}
            icon={<Sparkles className="size-5" />}
            label="Найближчі"
            onClick={() => setTab("upcoming")}
          />
          <NavButton
            active={filtersOpen}
            icon={<SlidersHorizontal className="size-5" />}
            label="Проєкти"
            onClick={() => setFiltersOpen(true)}
          />
        </div>
      </nav>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-3xl bg-card">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display">Фільтр за проєктами</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-safe">
            <ProjectFilter
              vertical
              selected={selectedProjects}
              onToggle={toggleProject}
              onReset={() => setSelectedProjects([])}
            />
          </div>
        </SheetContent>
      </Sheet>

      {authOpen ? (
        <AuthGate onAuthorized={handleAuthorized} onCancel={() => setAuthOpen(false)} />
      ) : null}

      {isAuthorized ? (
        <EventSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          date={sheetDate}
          event={editing}
          onSaved={() => void qc.invalidateQueries()}
        />
      ) : null}

      {introVisible ? <LaunchIntro onSkip={() => setIntroVisible(false)} /> : null}
    </div>
  );
}

function LaunchIntro({ onSkip }: { onSkip: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let raf = 0;
    const startedAt = performance.now();
    const colors = {
      gold: "rgba(255, 170, 74, 0.88)",
      pink: "rgba(255, 64, 174, 0.84)",
      violet: "rgba(134, 74, 255, 0.86)",
      cyan: "rgba(92, 219, 255, 0.72)",
      white: "rgba(255, 255, 255, 0.92)",
    };

    const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
    const smooth = (x: number) => {
      const t = Math.max(0, Math.min(1, x));
      return t * t * (3 - 2 * t);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { innerWidth: width, innerHeight: height } = window;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const roundedRect = (x: number, y: number, width: number, height: number, radius: number) => {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
    };

    const draw = (now: number) => {
      frame += 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const t = reduceMotion ? 0.78 : Math.min((now - startedAt) / 6000, 1);
      const cx = width / 2;
      const cy = height * 0.47;
      const scale = Math.min(width / 390, height / 760, 1.25);

      ctx.clearRect(0, 0, width, height);

      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, "#111018");
      bg.addColorStop(0.45, "#1b1823");
      bg.addColorStop(1, "#0d0c12");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const glowA = ctx.createRadialGradient(
        cx,
        cy - 90 * scale,
        0,
        cx,
        cy - 90 * scale,
        360 * scale,
      );
      glowA.addColorStop(0, `rgba(255, 64, 174, ${0.28 + Math.sin(t * 8) * 0.04})`);
      glowA.addColorStop(0.42, "rgba(134, 74, 255, 0.13)");
      glowA.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glowA;
      ctx.fillRect(0, 0, width, height);

      const glowB = ctx.createRadialGradient(
        cx + 110 * scale,
        cy + 120 * scale,
        0,
        cx + 110 * scale,
        cy + 120 * scale,
        280 * scale,
      );
      glowB.addColorStop(0, "rgba(255, 170, 74, 0.18)");
      glowB.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glowB;
      ctx.fillRect(0, 0, width, height);

      const tileStart = ease((t - 0.2) / 0.28);
      const tileW = 34 * scale;
      const tileH = 30 * scale;
      const gap = 8 * scale;
      const gridW = tileW * 5 + gap * 4;
      const gridH = tileH * 3 + gap * 2;
      const gridX = cx - gridW / 2;
      const gridY = cy + 96 * scale;

      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          const idx = row * 5 + col;
          const local = ease((t - 0.24 - idx * 0.012) / 0.22);
          const x = gridX + col * (tileW + gap);
          const y = gridY + row * (tileH + gap) + (1 - local) * 34 * scale;
          const hot = idx === 2 || idx === 8 || idx === 13;
          ctx.globalAlpha = tileStart * local * (hot ? 0.94 : 0.52);
          roundedRect(x, y, tileW, tileH, 9 * scale);
          const tileGradient = ctx.createLinearGradient(x, y, x + tileW, y + tileH);
          tileGradient.addColorStop(0, hot ? colors.pink : "rgba(255,255,255,0.12)");
          tileGradient.addColorStop(1, hot ? colors.gold : "rgba(255,255,255,0.03)");
          ctx.fillStyle = tileGradient;
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.11)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      const threadIn = smooth((t - 0.34) / 0.32);
      for (let i = 0; i < 18; i += 1) {
        const angle = i * 1.618 + t * 5;
        const radius = (74 + ((i * 29) % 130)) * scale;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle * 0.82) * radius * 0.62;
        const twinkle = (Math.sin(t * 18 + i) + 1) / 2;
        ctx.globalAlpha = (0.05 + twinkle * 0.22) * threadIn;
        ctx.fillStyle = i % 4 === 0 ? colors.gold : i % 3 === 0 ? colors.cyan : colors.white;
        ctx.beginPath();
        ctx.arc(px, py, (0.85 + twinkle * 0.9) * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (!reduceMotion && t < 1) {
        raf = requestAnimationFrame(draw);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      className="motion-intro fixed inset-0 grid place-items-center overflow-hidden bg-background px-5 pt-safe text-foreground"
      aria-label="ECHO Events intro"
    >
      <canvas ref={canvasRef} className="motion-intro-canvas absolute inset-0" aria-hidden />
      <div className="motion-intro-vignette absolute inset-0" aria-hidden />

      <button
        type="button"
        onClick={onSkip}
        className="motion-intro-skip absolute right-4 top-4 rounded-full border border-border bg-card/70 px-3 py-2 text-xs font-bold uppercase text-muted-foreground backdrop-blur-md"
      >
        Пропустити
      </button>

      <div className="motion-intro-content relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <div className="motion-intro-mark-wrap">
          <div className="motion-intro-halo" aria-hidden />
          <div className="motion-intro-mark gradient-bg grid place-items-center rounded-[1.75rem] shadow-glow">
            <img src="/icon-192.png" alt="" className="rounded-2xl" />
          </div>
        </div>
        <p className="motion-intro-kicker mt-8 text-xs font-bold uppercase text-muted-foreground">
          Opening workspace
        </p>
        <h1 className="motion-intro-title mt-2 font-display text-5xl font-bold">
          <span className="gradient-text">ECHO</span> Events
        </h1>
        <div className="motion-intro-bars mt-7" aria-hidden>
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <div className="motion-intro-progress mt-8 w-full max-w-xs overflow-hidden rounded-full bg-elevated">
          <span />
        </div>
        <div className="motion-intro-status mt-4 flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-xs font-semibold text-muted-foreground backdrop-blur-md">
          <Sparkles className="size-4 text-primary" />
          Запускаємо календар
        </div>
      </div>
    </section>
  );
}

function AuthGate({ onAuthorized, onCancel }: { onAuthorized: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const passwordProgress = Math.min(password.length, ACCESS_PASSWORD.length);
  const hasInput = password.length > 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password === ACCESS_PASSWORD) {
      setError("");
      onAuthorized();
      return;
    }
    setError("Неправильний пароль");
    setPassword("");
  };

  return (
    <div className="auth-backdrop fixed inset-0 z-50 grid place-items-center bg-background/85 px-4 py-10 backdrop-blur-xl">
      <form
        onSubmit={submit}
        className={cn(
          "auth-card w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-float",
          error ? "auth-card-error" : "",
        )}
      >
        <div className="mb-5 flex items-center gap-3">
          <span
            className={cn(
              "auth-lock gradient-bg grid size-12 place-items-center rounded-2xl text-primary-foreground shadow-glow",
              hasInput ? "auth-lock-active" : "",
              passwordProgress === ACCESS_PASSWORD.length ? "auth-lock-ready" : "",
            )}
          >
            <span className="auth-lock-ring" aria-hidden />
            <span className="auth-spark auth-spark-a" aria-hidden />
            <span className="auth-spark auth-spark-b" aria-hidden />
            <LockKeyhole className="size-6" />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold">
              <span className="gradient-text">ECHO</span> Events
            </h1>
            <p className="text-sm text-muted-foreground">Доступ до календаря</p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-2" aria-hidden>
          {Array.from({ length: ACCESS_PASSWORD.length }, (_, index) => (
            <span
              key={index}
              className={cn(
                "auth-digit h-2 rounded-full bg-elevated",
                index < passwordProgress ? "auth-digit-filled" : "",
              )}
            />
          ))}
        </div>

        <label htmlFor="site-password" className="mb-2 block text-sm font-semibold">
          Пароль
        </label>
        <input
          id="site-password"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError("");
          }}
          className={cn(
            "w-full rounded-xl border border-input bg-elevated px-4 py-3.5 text-base outline-none focus:border-primary",
            hasInput ? "auth-input-active" : "",
            error ? "auth-input-error" : "",
          )}
          autoFocus
        />
        {error ? <p className="mt-2 text-sm font-semibold text-destructive">{error}</p> : null}
        <button
          type="submit"
          className="gradient-bg mt-5 flex h-12 w-full items-center justify-center rounded-xl font-bold text-primary-foreground shadow-glow"
        >
          Увійти
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-xl border border-border bg-elevated font-semibold text-muted-foreground"
        >
          Скасувати
        </button>
      </form>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  onFocusTab,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocusTab: () => void;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocusTab}
        placeholder="Пошук: назва, проєкт, локація, опис"
        className="w-full rounded-xl border border-input bg-elevated py-3.5 pl-11 pr-10 text-base outline-none focus:border-primary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Очистити пошук"
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function ResultRow({ event, onOpen }: { event: EventRow; onOpen: () => void }) {
  const project = getProject(event.project);
  const time = formatTime(event.event_time);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="result-row flex w-full items-stretch gap-3 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-soft active:scale-[0.99]"
    >
      <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{event.title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatLongDate(event.event_date)}
          {time ? ` · ${time}` : ""}
          {event.location ? ` · ${event.location}` : ""}
        </span>
        <span className="mt-1 block text-xs font-medium" style={{ color: project.color }}>
          {project.name}
        </span>
      </span>
    </button>
  );
}

function UpcomingList({ events, onOpen }: { events: EventRow[]; onOpen: (e: EventRow) => void }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Найближчих подій немає</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {events.map((e) => {
        const project = getProject(e.project);
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onOpen(e)}
            className="sidebar-event flex items-stretch gap-2.5 rounded-xl bg-elevated p-2.5 text-left"
          >
            <span
              className="w-1 shrink-0 rounded-full"
              style={{ backgroundColor: project.color }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{e.title}</span>
              <span className="block text-xs text-muted-foreground">
                {formatLongDate(e.event_date)}
                {formatTime(e.event_time) ? ` · ${formatTime(e.event_time)}` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mobile-nav-button flex h-16 flex-col items-center justify-center gap-1 text-[0.68rem] font-semibold",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function BrandLockup({ size, className }: { size: "desktop" | "mobile"; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)} aria-label="ECHO Marketing">
      <img
        src="/icon-192.png"
        alt=""
        className={cn("rounded-xl", size === "desktop" ? "size-9" : "size-7")}
      />
      <div className="leading-none">
        <div className={cn("font-display font-bold", size === "desktop" ? "text-lg" : "text-base")}>
          <span className="gradient-text">ECHO</span>
        </div>
        <div className="text-[0.62rem] font-semibold uppercase text-muted-foreground">Events</div>
      </div>
    </div>
  );
}
