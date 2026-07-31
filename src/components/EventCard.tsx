import { Clock, MapPin, Link2 } from "lucide-react";
import type { EventRow } from "@/lib/events";
import { getProject } from "@/lib/projects";
import { formatTime } from "@/lib/date-utils";

export function EventCard({ event, onClick }: { event: EventRow; onClick: () => void }) {
  const project = getProject(event.project);
  const time = formatTime(event.event_time);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-stretch gap-3 rounded-xl bg-elevated p-3 text-left transition-transform active:scale-[0.985]"
    >
      <span
        className="w-1 shrink-0 rounded-full"
        style={{ backgroundColor: project.color }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          {time && (
            <span className="shrink-0 font-display text-sm font-bold tabular-nums text-foreground">
              {time}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold leading-snug">
            {event.title}
          </span>
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium" style={{ color: project.color }}>
            {project.name}
          </span>
          {!time && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> Без часу
            </span>
          )}
          {event.location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{event.location}</span>
            </span>
          )}
          {event.link && <Link2 className="size-3" />}
        </span>
      </span>
    </button>
  );
}
