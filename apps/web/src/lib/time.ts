import { create } from 'zustand';

/**
 * The app's clock.
 *
 * Every timestamp on screen goes through here, so choosing a timezone once
 * in Settings changes the charts, the log gutter, the tooltips and the age
 * hovers together. The choice sits in the title bar because a time with no
 * zone is a time you will misread at 2am.
 */

export type TimezoneChoice = 'system' | string;

const STORAGE_KEY = 'mjolnir.timezone';

function stored(): TimezoneChoice {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'system';
  } catch {
    return 'system';
  }
}

export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface TimezoneStore {
  choice: TimezoneChoice;
  /** The IANA zone in effect. */
  zone: string;
  set: (choice: TimezoneChoice) => void;
}

export const useTimezone = create<TimezoneStore>((set) => {
  const choice = stored();
  return {
    choice,
    zone: choice === 'system' ? systemTimezone() : choice,
    set: (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not saved, still applied for this session.
      }
      set({ choice: next, zone: next === 'system' ? systemTimezone() : next });
    },
  };
});

/** Every zone the runtime knows, for the picker. */
export function allTimezones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    return supported ? supported('timeZone') : ['UTC'];
  } catch {
    return ['UTC'];
  }
}

/** "UTC+02:00" for a zone right now. */
export function offsetLabel(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    return part ?? '';
  } catch {
    return '';
  }
}

const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = zone + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone });
    cache.set(key, f);
  }
  return f;
}

const zoneNow = () => useTimezone.getState().zone;

/** HH:MM:SS, for gutters and axes. */
export function formatClock(input: Date | number | string, zone = zoneNow()): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return formatter(zone, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

/** HH:MM, for axis ticks. */
export function formatHourMinute(input: Date | number, zone = zoneNow()): string {
  return formatter(zone, { hour: '2-digit', minute: '2-digit', hour12: false }).format(input);
}

/** "18 Sep 2026, 14:03:22 UTC+02:00", for tooltips and hovers. */
export function formatDateTime(input: Date | number | string, zone = zoneNow()): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatter(zone, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)} ${offsetLabel(zone, date)}`;
}

/** Minutes east of UTC for a zone, now. */
export function offsetMinutes(zone: string, at: Date = new Date()): number {
  const label = offsetLabel(zone, at); // "GMT+5:30", "GMT-8", "GMT"
  const match = /([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** "UTC+05:30" from minutes. */
export function utcLabel(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * The picker's list: system first, then every zone west to east, each with
 * its UTC offset in front so the list reads like a map rather than a
 * dictionary.
 */
export function timezoneOptions(): Array<{ value: string; label: string; hint: string }> {
  const now = new Date();
  const zones = allTimezones()
    .map((zone) => ({ zone, minutes: offsetMinutes(zone, now) }))
    .sort((a, b) => a.minutes - b.minutes || a.zone.localeCompare(b.zone));
  const system = systemTimezone();
  return [
    { value: 'system', label: `System: ${system.replace(/_/g, ' ')}`, hint: utcLabel(offsetMinutes(system, now)) },
    ...zones.map(({ zone, minutes }) => ({ value: zone, label: zone.replace(/_/g, ' '), hint: utcLabel(minutes) })),
  ];
}
