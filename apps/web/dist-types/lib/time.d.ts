/**
 * The app's clock.
 *
 * Every timestamp on screen goes through here, so choosing a timezone once
 * in Settings changes the charts, the log gutter, the tooltips and the age
 * hovers together. The choice sits in the title bar because a time with no
 * zone is a time you will misread at 2am.
 */
export type TimezoneChoice = 'system' | string;
export declare function systemTimezone(): string;
interface TimezoneStore {
    choice: TimezoneChoice;
    /** The IANA zone in effect. */
    zone: string;
    set: (choice: TimezoneChoice) => void;
}
export declare const useTimezone: import("zustand").UseBoundStore<import("zustand").StoreApi<TimezoneStore>>;
/** Every zone the runtime knows, for the picker. */
export declare function allTimezones(): string[];
/** "UTC+02:00" for a zone right now. */
export declare function offsetLabel(zone: string, at?: Date): string;
/** HH:MM:SS, for gutters and axes. */
export declare function formatClock(input: Date | number | string, zone?: string): string;
/** HH:MM, for axis ticks. */
export declare function formatHourMinute(input: Date | number, zone?: string): string;
/** "18 Sep 2026, 14:03:22 UTC+02:00", for tooltips and hovers. */
export declare function formatDateTime(input: Date | number | string, zone?: string): string;
/** Minutes east of UTC for a zone, now. */
export declare function offsetMinutes(zone: string, at?: Date): number;
/** "UTC+05:30" from minutes. */
export declare function utcLabel(minutes: number): string;
/**
 * The picker's list: system first, then every zone west to east, each with
 * its UTC offset in front so the list reads like a map rather than a
 * dictionary.
 */
export declare function timezoneOptions(): Array<{
    value: string;
    label: string;
    hint: string;
}>;
export {};
//# sourceMappingURL=time.d.ts.map