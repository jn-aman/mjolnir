/**
 * Per-kind table preferences.
 *
 * Column widths, order and visibility are stored per resource kind, because the
 * columns that matter for Pods are not the ones that matter for Secrets and a
 * single shared layout would be wrong for both.
 *
 * Kept in localStorage, which can throw in a private window or with site data
 * blocked. Every read and write is guarded: losing a saved layout is a small
 * annoyance, and a crash on startup is not.
 */
export interface TablePrefs {
    readonly order: string[];
    readonly hidden: string[];
    readonly widths: Record<string, number>;
}
export declare function useTablePrefs(kind: string): {
    prefs: TablePrefs;
    update: (patch: Partial<TablePrefs>) => void;
    reset: () => void;
};
//# sourceMappingURL=tablePrefs.d.ts.map