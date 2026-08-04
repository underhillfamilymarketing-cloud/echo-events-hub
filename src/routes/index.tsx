import { useEffect, useMemo, useState, type FormEvent } from "react";
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
    return merged.filter(matchesProject).sort((a, b) => a.event_date.localeCompare(b.event_date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery.data, upcomingQuery.data, debounced, selectedProjects]);

  const upcoming = (upcomingQuery.data ?? []).filter(matchesProject);

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
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl lg:gap-6 lg:px-6 lg:py-6">
        {/* Desktop sidebar */}
        <aside className="hidden w-80 shrink-0 flex-col gap-4 lg:flex">
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
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

          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
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

          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
            <p className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-4" /> Найближчі
            </p>
            <UpcomingList events={upcoming.slice(0, 8)} onOpen={openEdit} />
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 pb-32 lg:pb-0">
          <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 px-4 pt-safe backdrop-blur-xl lg:static lg:rounded-2xl lg:border lg:bg-card lg:px-5 lg:shadow-soft">
            <div className="flex items-center justify-between gap-3 py-3">
              <BrandLockup size="mobile" className="lg:hidden" />
              <div className="hidden lg:block">
                <h1 className="font-display text-xl font-bold">
                  <span className="gradient-text">ECHO</span> Events
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={isAuthorized ? handleLogout : () => setAuthOpen(true)}
                  className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold lg:bg-elevated"
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
                  className="rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold lg:bg-elevated"
                >
                  Сьогодні
                </button>
                <div className="flex rounded-full border border-border bg-card p-1 lg:bg-elevated">
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

            <div className="flex items-center justify-between gap-2 pb-3">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Попередній місяць"
                className="grid size-10 place-items-center rounded-xl bg-card lg:bg-elevated"
              >
                <ChevronLeft className="size-5" />
              </button>
              <h2 className="font-display text-lg font-bold">{monthLabel(year, month)}</h2>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Наступний місяць"
                className="grid size-10 place-items-center rounded-xl bg-card lg:bg-elevated"
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

          <div className="px-4 pt-4 lg:px-0">
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
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/95 pb-safe backdrop-blur-xl lg:hidden">
        <div className="grid grid-cols-6 items-center px-2">
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
              className="gradient-bg -mt-6 grid size-16 place-items-center rounded-full text-primary-foreground shadow-glow transition-transform active:scale-95"
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
          <NavButton
            active={false}
            icon={isAuthorized ? <LogOut className="size-5" /> : <LockKeyhole className="size-5" />}
            label={isAuthorized ? "Вийти" : "Редаг."}
            onClick={isAuthorized ? handleLogout : () => setAuthOpen(true)}
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
    </div>
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
      className="flex w-full items-stretch gap-3 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-soft active:scale-[0.99]"
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
            className="flex items-stretch gap-2.5 rounded-xl bg-elevated p-2.5 text-left"
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
        "flex h-16 flex-col items-center justify-center gap-1 text-[0.68rem] font-semibold",
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
