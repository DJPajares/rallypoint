/*
 * Wall-clock date helpers for "YYYY-MM-DDTHH:mm" strings, the format a
 * datetime-local input produces and the session form stores. The values carry
 * no timezone: they are read as local Date objects only so the calendar can
 * show them, and written back field by field, never through an offset.
 */
const pattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const pad = (value: number) => String(value).padStart(2, "0");
export function splitLocalDateTime(value: string) {
  const match = value.match(pattern);
  if (!match) return { date: null, time: null };
  const [, y, m, d, h, min] = match;
  return {
    date: new Date(Number(y), Number(m) - 1, Number(d)),
    time: `${h}:${min}`,
  };
}
export function joinLocalDateTime(date: Date, time: string) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
}
function timeLabel(time: string) {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, h, m));
}
/** "Thu, Nov 5 · 7:00 PM", or null when there is no valid value. */
export function formatLocalDateTime(value: string) {
  const { date, time } = splitLocalDateTime(value);
  if (!date || !time) return null;
  const day = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
  return `${day} · ${timeLabel(time)}`;
}
/** Every time of day at the given minute step, or exactly the given times. */
export function timeSlots(step: number, only?: string[]) {
  const values =
    only ??
    Array.from({ length: (24 * 60) / step }, (_, i) => {
      const minutes = i * step;
      return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    });
  return values.map((value) => ({ value, label: timeLabel(value) }));
}
