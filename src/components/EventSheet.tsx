import { useEffect, useState } from "react";
import { Trash2, Calendar, Clock, MapPin, Link2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
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
import { formatLongDate } from "@/lib/date-utils";
import { createEvent, updateEvent, deleteEvent, type EventRow } from "@/lib/events";
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
        : { ...emptyForm, event_date: date },
    );
  }, [open, event, date]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Вкажіть назву події");
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

  const fieldClass =
    "w-full rounded-xl border border-input bg-elevated px-4 py-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary";

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <DrawerContent className="max-h-[92vh] border-border bg-card">
          <div className="mx-auto flex w-full max-w-xl flex-col overflow-hidden">
            <DrawerHeader className="px-4 pb-2 text-left">
              <DrawerTitle className="font-display text-xl">
                {event ? "Редагувати подію" : "Нова подія"}
              </DrawerTitle>
              <DrawerDescription className="text-muted-foreground">
                {form.event_date ? formatLongDate(form.event_date) : ""}
              </DrawerDescription>
            </DrawerHeader>

            <form
              onSubmit={handleSave}
              className="flex flex-col gap-4 overflow-y-auto px-4 pb-4 pt-1"
            >
              <div>
                <label htmlFor="title" className="mb-1.5 block text-sm font-semibold">
                  Назва <span className="text-primary">*</span>
                </label>
                <input
                  id="title"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="Наприклад: Зйомка контенту"
                  autoComplete="off"
                  maxLength={140}
                  className={fieldClass}
                />
              </div>

              <div>
                <p className="mb-1.5 block text-sm font-semibold">Проєкт</p>
                <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                  {PROJECTS.map((p) => {
                    const active = form.project === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => set("project", p.id)}
                        style={
                          active
                            ? {
                                backgroundColor: p.color,
                                borderColor: p.color,
                                color: "oklch(0.16 0.03 268)",
                              }
                            : { borderColor: `color-mix(in oklab, ${p.color} 45%, transparent)` }
                        }
                        className={cn(
                          "shrink-0 whitespace-nowrap rounded-full border px-4 py-2.5 text-sm font-semibold",
                          active ? "" : "bg-elevated",
                        )}
                      >
                        {p.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="date"
                    className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"
                  >
                    <Calendar className="size-3.5" /> Дата
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
                  <label
                    htmlFor="time"
                    className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"
                  >
                    <Clock className="size-3.5" /> Час
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
                <label
                  htmlFor="location"
                  className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"
                >
                  <MapPin className="size-3.5" /> Локація
                </label>
                <input
                  id="location"
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Необов’язково"
                  maxLength={200}
                  className={fieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="description"
                  className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"
                >
                  <FileText className="size-3.5" /> Опис
                </label>
                <textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Необов’язково"
                  rows={3}
                  maxLength={2000}
                  className={cn(fieldClass, "resize-none")}
                />
              </div>

              <div>
                <label
                  htmlFor="link"
                  className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"
                >
                  <Link2 className="size-3.5" /> Посилання
                </label>
                <input
                  id="link"
                  type="url"
                  inputMode="url"
                  value={form.link}
                  onChange={(e) => set("link", e.target.value)}
                  placeholder="https://"
                  maxLength={500}
                  className={fieldClass}
                />
              </div>

              {event?.link && (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm font-semibold text-primary underline underline-offset-4"
                >
                  Відкрити посилання
                </a>
              )}

              <div className="sticky bottom-0 -mx-4 flex gap-2 bg-card px-4 pb-safe pt-3">
                {event && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Видалити подію"
                    className="grid size-14 shrink-0 place-items-center rounded-2xl border border-destructive/40 text-destructive"
                  >
                    <Trash2 className="size-5" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="gradient-bg flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-base font-bold text-primary-foreground shadow-glow disabled:opacity-60"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {event ? "Зберегти зміни" : "Додати подію"}
                </button>
              </div>
            </form>
          </div>
        </DrawerContent>
      </Drawer>

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
