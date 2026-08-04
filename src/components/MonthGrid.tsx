import type { EventRow } from "@/lib/events";
import { getProject } from "@/lib/projects";
import { WEEKDAYS_SHORT, dayNumber, weekdayIndex, daysInMonth } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

type Props = {
  year: number;
  month: number;
  eventsByDay: Map<string, EventRow[]>;
  todayIso: string;
  canEdit?: boolean;
  onSelectDay: (iso: string) => void;
};

export function MonthGrid({
  year,
  month,
  eventsByDay,
  todayIso,
  canEdit = false,
  onSelectDay,
}: Props) {
  const days = daysInMonth(year, month);
  const lead = weekdayIndex(days[0] ?? `${year}-01-01`);

  return (
    <div className="month-grid-card rounded-2xl border border-border/60 bg-card p-3 shadow-soft sm:p-4">
      <div className="grid grid-cols-7 gap-1 pb-2">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="text-center text-[0.7rem] font-semibold text-muted-foreground">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {days.map((iso) => {
          const dayEvents = eventsByDay.get(iso) ?? [];
          const isToday = iso === todayIso;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => {
                if (canEdit) onSelectDay(iso);
              }}
              aria-disabled={!canEdit}
              className={cn(
                "month-cell flex aspect-square flex-col items-center justify-start gap-1 rounded-xl p-1 pt-1.5 transition-colors active:bg-accent",
                isToday ? "gradient-bg text-primary-foreground" : "bg-elevated",
                !canEdit ? "cursor-default" : "",
              )}
            >
              <span className="font-display text-sm font-bold tabular-nums">{dayNumber(iso)}</span>
              <span className="flex max-w-full flex-wrap justify-center gap-0.5">
                {dayEvents.slice(0, 4).map((e) => (
                  <span
                    key={e.id}
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: getProject(e.project).color }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
