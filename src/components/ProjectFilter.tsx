import { PROJECTS } from "@/lib/projects";
import { cn } from "@/lib/utils";

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  onReset: () => void;
  vertical?: boolean;
};

export function ProjectFilter({ selected, onToggle, onReset, vertical }: Props) {
  const all = selected.length === 0;

  return (
    <div
      className={cn(
        vertical
          ? "flex flex-col gap-1.5"
          : "no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1",
      )}
    >
      <button
        type="button"
        onClick={onReset}
        className={cn(
          "project-chip shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
          vertical && "text-left",
          all
            ? "gradient-bg border-transparent text-primary-foreground shadow-glow"
            : "border-border bg-card text-muted-foreground",
        )}
      >
        Усі проєкти
      </button>
      {PROJECTS.map((p) => {
        const active = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            style={
              active
                ? { backgroundColor: p.color, borderColor: p.color, color: "oklch(0.16 0.03 268)" }
                : { borderColor: `color-mix(in oklab, ${p.color} 45%, transparent)` }
            }
            className={cn(
              "project-chip flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
              vertical ? "justify-start text-left" : "",
              active ? "" : "bg-card text-foreground",
            )}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: active ? "oklch(0.16 0.03 268)" : p.color }}
            />
            <span className="max-w-[13rem] truncate whitespace-nowrap">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
