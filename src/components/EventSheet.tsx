import { useEffect, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PROJECTS } from "@/lib/projects";
import { createEvent, deleteEvent, updateEvent, type EventRow } from "@/lib/events";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  event: EventRow | null;
  onSaved: () => void;
};

const emptyForm = {
  title: "",
  project: "echo",
  event_date: "",
  event_time: "",
  location: "",
  description: "",
  link: "",
};

export function EventSheet({ open, onOpenChange, date, event, onSaved }: Props) {
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      event
        ? {
            title: event.title,
            project: event.project,
            event_date: event.event_date,
            event_time: event.event_time ? event.event_time.slice(0, 5) : "",
            location: event.location ?? "",
            description: event.description ?? "",
            link: event.link ?? "",
          }
        : { ...emptyForm, event_date: date, event_time: "09:00" },
    );
  }, [open, event, date]);

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Вкажіть назву події");
      return;
    }
    if (!form.event_date) {
      toast.error("Вкажіть дату події");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        project: form.project,
        event_date: form.event_date,
        event_time: form.event_time ? form.event_time : null,
        location: form.location.trim() || null,
        description: form.description.trim() || null,
        link: form.link.trim() || null,
      };

      if (event) {
        await updateEvent(event.id, payload);
        toast.success("Подію оновлено");
      } else {
        await createEvent(payload);
        toast.success("Подію додано");
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не вдалося зберегти подію");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!event) return;
    setSaving(true);
    try {
      await deleteEvent(event.id);
      toast.success("Подію видалено");
      onSaved();
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не вдалося видалити подію");
    } finally {
      setSaving(false);
    }
  }

  const canSave = Boolean(form.title.trim() && form.event_date && !saving);
  const fieldClass =
    "event-editor-field w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30";
  const labelClass = "mb-1.5 block text-xs font-medium text-muted-foreground";

  return (
    <>
      {open ? (
        <div className="event-editor-shell fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Закрити форму"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-editor-title"
            className="event-editor-panel relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <h2 id="event-editor-title" className="font-display text-base font-semibold">
                {event ? "Редагувати подію" : "Нова подія"}
              </h2>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Закрити"
              >
                <X className="size-4" />
              </button>
            </div>

            <form
              onSubmit={handleSave}
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"
            >
              <div>
                <label htmlFor="title" className={labelClass}>
                  Назва події
                </label>
                <input
                  id="title"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="Наприклад, Reel про новинку"
                  autoComplete="off"
                  maxLength={140}
                  className={fieldClass}
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="project" className={labelClass}>
                  Проєкт
                </label>
                <select
                  id="project"
                  value={form.project}
                  onChange={(e) => set("project", e.target.value)}
                  className={fieldClass}
                >
                  {PROJECTS.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="date" className={labelClass}>
                    Дата
                  </label>
                  <input
                    id="date"
                    type="date"
                    value={form.event_date}
                    onChange={(e) => set("event_date", e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label htmlFor="time" className={labelClass}>
                    Час
                  </label>
                  <input
                    id="time"
                    type="time"
                    value={form.event_time}
                    onChange={(e) => set("event_time", e.target.value)}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="location" className={labelClass}>
                  Локація
                </label>
                <input
                  id="location"
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Де відбувається, наприклад студія або онлайн"
                  maxLength={200}
                  className={fieldClass}
                />
              </div>

              <div>
                <label htmlFor="description" className={labelClass}>
                  Опис
                </label>
                <textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Деталі, завдання або що потрібно підготувати"
                  rows={3}
                  maxLength={2000}
                  className={cn(fieldClass, "resize-none")}
                />
              </div>

              <div>
                <label htmlFor="link" className={labelClass}>
                  Посилання
                </label>
                <input
                  id="link"
                  type="url"
                  inputMode="url"
                  value={form.link}
                  onChange={(e) => set("link", e.target.value)}
                  placeholder="Лінк на бриф, матеріали або документ"
                  maxLength={500}
                  className={fieldClass}
                />
              </div>

              {event?.link ? (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm font-semibold text-primary underline underline-offset-4"
                >
                  Відкрити посилання
                </a>
              ) : null}

              <div className="mt-1 flex items-center gap-2">
                {event ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Видалити подію"
                    className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <Trash2 className="size-4" />
                    Видалити
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={!canSave}
                  className="ml-auto flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {event ? "Зберегти" : "Додати подію"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-2xl border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити подію?</AlertDialogTitle>
            <AlertDialogDescription>
              Подію «{event?.title}» буде остаточно видалено для всіх користувачів.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Скасувати</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="rounded-xl bg-destructive text-destructive-foreground"
            >
              Видалити
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
