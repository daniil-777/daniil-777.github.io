import type { ClockAngles, ClockParts, ClockSnapshot } from './types.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Reject invalid IANA names at the configuration boundary. Empty uses device time. */
export function validateTimeZone(timeZone = ''): string {
  if (timeZone.length > 100) throw new RangeError('Invalid time zone');
  if (timeZone) new Intl.DateTimeFormat('en-GB', { timeZone }).format();
  return timeZone;
}

export function clockParts(date: Date, timeZone = ''): ClockParts {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid clock date');
  if (!timeZone) return {
    hours: date.getHours(), minutes: date.getMinutes(), seconds: date.getSeconds(),
    milliseconds: date.getMilliseconds(),
  };
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    validateTimeZone(timeZone);
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    // Settings normally expose two zones. Bound external mount API use as well.
    if (formatters.size >= 16) formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { hours: read('hour'), minutes: read('minute'), seconds: read('second'), milliseconds: date.getMilliseconds() };
}

/** Derive every frame from the clock; never accumulate ticks or elapsed angles. */
export function clockAngles(parts: ClockParts): ClockAngles {
  const second = parts.seconds + parts.milliseconds / 1_000;
  return {
    second: 6 * second,
    minute: 6 * (parts.minutes + second / 60),
    hour: 30 * ((parts.hours % 12) + parts.minutes / 60 + second / 3_600),
  };
}

export function readClock(date = new Date(), timeZone = ''): ClockSnapshot {
  const parts = clockParts(date, timeZone);
  const angles = clockAngles(parts);
  const pad = (value: number) => String(value).padStart(2, '0');
  const zoneLabel = timeZone || 'local time';
  return {
    epochMs: date.getTime(), parts, angles, phase: angles.second * Math.PI / 180,
    label: `${pad(parts.hours)}:${pad(parts.minutes)} · ${zoneLabel}`,
    timeZone,
  };
}
