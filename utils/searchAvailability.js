const HALF_WINDOW_MS = 30 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Convert local time and its UTC offset into a one-hour matching window. */
export function searchAvailability({ date, time, timeZone, utcOffsetMinutes } = {}) {
  const dateParts = typeof date === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeParts = typeof time === 'string' && /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateParts || !timeParts) throw new Error('Invalid local date or time');
  const [, yearText, monthText, dayText] = dateParts;
  const [, hourText, minuteText] = timeParts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Invalid local date or time');
  }
  if (!Number.isInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > 840) {
    throw new Error('Invalid UTC offset');
  }
  if (typeof timeZone !== 'string' || !timeZone || timeZone.trim() !== timeZone || /^[+-]/.test(timeZone)) {
    throw new Error('Invalid time zone');
  }

  // setUTCFullYear avoids Date.UTC's special interpretation of years 0–99.
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, 0, 0);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) {
    throw new Error('Invalid local date or time');
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    throw new Error('Invalid time zone');
  }
  const instant = local.getTime() - utcOffsetMinutes * MINUTE_MS;
  // Convert back in the chosen zone to catch wrong offsets and skipped clock times.
  const fields = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  if (Number(fields.year) !== year || Number(fields.month) !== month || Number(fields.day) !== day ||
      Number(fields.hour) !== hour || Number(fields.minute) !== minute) {
    throw new Error('Local time and UTC offset do not match the time zone');
  }
  return { startMs: instant - HALF_WINDOW_MS, endMs: instant + HALF_WINDOW_MS };
}

/** Touching windows count as a match, allowing times exactly 60 minutes apart. */
export function availabilityOverlaps(first, second) {
  return first.startMs <= second.endMs && second.startMs <= first.endMs;
}
