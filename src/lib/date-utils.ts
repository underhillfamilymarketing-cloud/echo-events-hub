export const MONTHS = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];

export const MONTHS_GEN = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];

export const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
export const WEEKDAYS_FULL = [
  "Неділя",
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П’ятниця",
  "Субота",
];

export function toISO(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function daysInMonth(year: number, month: number): string[] {
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => toISO(new Date(year, month, i + 1)));
}

/** Monday-first index 0..6 */
export function weekdayIndex(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  return (d.getDay() + 6) % 7;
}

export function dayNumber(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatTime(t: string | null): string | null {
  if (!t) return null;
  return t.slice(0, 5);
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}
