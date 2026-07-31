import { Plus } from "lucide-react";
import type { EventRow } from "@/lib/events";
import { EventCard } from "./EventCard";
import { dayNumber, weekdayIndex, WEEKDAYS_SHORT } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

type Props = {
  iso: string;
  events: EventRow[];
  isToday: boolean;
  onAdd: (iso: string) => void;
  onOpen: (event: EventRow) => void;
};

export function DayRow({ iso, events, isToday, onAdd, onOpen }: Props) {
  const wd = weekdayIndex(iso);
  const weekend = wd >= 5;

  return (
    <section
      id={`day-${iso}`}
      className={cn(
        "rounded-2xl border bg-card p-3 shadow-soft transition-colors sm:p-4",
        isToday ? "border-today/60" : "border-border/60",
      )}
    >
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <div
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-xl",
            isToday ? "gradient-bg text-primary-foreground shadow-glow" : "bg-elevated",
          )}
        >
          <span className="font-display text-lg font-bold leading-none tabular-nums">
            {dayNumber(iso)}
          </span>
        </div>
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-sm font-semibold",
              weekend && !isToday ? "text-muted-foreground" : "",
            )}
          >
            {WEEKDAYS_SHORT[wd]}
            {isToday && <span className="ml-2 text-xs font-bold text-today">Сьогодні</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {events.length > 0 ? `${events.length} подій` : "Немає подій"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onAdd(iso)}
          aria-label="Додати подію"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-elevated text-muted-foreground transition-colors active:bg-accent"
        >
          <Plus className="size-5" />
        </button>
      </header>

      {events.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {events.map((e) => (
            <EventCard key={e.id} event={e} onClick={() => onOpen(e)} />
          ))}
        </div>
      )}
    </section>
  );
}
