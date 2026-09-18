export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
interface ThemeStore {
    choice: ThemeChoice;
    resolved: ResolvedTheme;
    set(choice: ThemeChoice): void;
}
export declare const useTheme: import("zustand").UseBoundStore<import("zustand").StoreApi<ThemeStore>>;
export {};
//# sourceMappingURL=theme.d.ts.map