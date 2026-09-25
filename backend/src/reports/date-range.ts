import { badRequest } from "../errors";

export const BOGOTA_TIME_ZONE = "America/Bogota";
const BOGOTA_UTC_OFFSET = "-05:00";
const MAX_RANGE_DAYS = 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

/** A validated, half-open UTC instant range built from two Bogotá calendar dates (`desde`/`hasta` inclusive). */
export interface DateRange {
  readonly desde: string;
  readonly from: Date;
  readonly hasta: string;
  /** Exclusive upper bound: midnight Bogotá time of the day after `hasta`. */
  readonly to: Date;
}

interface CalendarDate {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

/** Parse a strict `YYYY-MM-DD` string into a real calendar date, rejecting values like `2026-02-30`. */
function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw badRequest();
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw badRequest();
  }

  return { day, month, year };
}

/** Build the UTC instant for midnight Bogotá time (fixed UTC-5, no daylight saving) of the given calendar date. */
function bogotaMidnight(date: CalendarDate): Date {
  const iso = `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}T00:00:00${BOGOTA_UTC_OFFSET}`;
  return new Date(iso);
}

/** The current calendar date in Bogotá, as `YYYY-MM-DD`. */
export function todayInBogota(): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
  }).format(new Date());
}

/**
 * Validate and convert a `desde`/`hasta` (`YYYY-MM-DD`) admin report request into a half-open UTC range:
 * `from` is `desde` at 00:00:00 Bogotá time (inclusive), `to` is the day after `hasta` at 00:00:00 Bogotá time
 * (exclusive). Rejects invalid calendar dates, `desde > hasta`, `hasta` after today (Bogotá), and ranges spanning
 * more than 366 days.
 */
export function parseDateRange(desde: string, hasta: string): DateRange {
  const desdeDate = parseCalendarDate(desde);
  const hastaDate = parseCalendarDate(hasta);

  // YYYY-MM-DD is fixed-width, so lexicographic comparison matches chronological order.
  if (desde > hasta) {
    throw badRequest();
  }

  if (hasta > todayInBogota()) {
    throw badRequest();
  }

  const from = bogotaMidnight(desdeDate);
  const toExclusiveUtcDay = new Date(Date.UTC(hastaDate.year, hastaDate.month - 1, hastaDate.day + 1));
  const to = bogotaMidnight({
    day: toExclusiveUtcDay.getUTCDate(),
    month: toExclusiveUtcDay.getUTCMonth() + 1,
    year: toExclusiveUtcDay.getUTCFullYear(),
  });

  const rangeDays = Math.round((to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY);
  if (rangeDays > MAX_RANGE_DAYS) {
    throw badRequest();
  }

  return { desde, from, hasta, to };
}
