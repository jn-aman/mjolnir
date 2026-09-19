import { type ReactNode } from 'react';
import { type FlagState } from './api.ts';
/**
 * Flag values, read once and shared.
 *
 * The values are resolved on the server, where the override, the Unleash
 * answer and the build default all live, so the UI never has to know the
 * precedence rules; it asks whether a thing is on.
 *
 * Until the first answer arrives every flag reads false. That is the right way
 * round: a module that flickers into the rail and out again is worse than one
 * that appears a beat late, and a feature nobody has enabled should never show
 * even for a frame.
 */
interface FlagsValue {
    readonly values: Readonly<Record<string, boolean>>;
    readonly states: readonly FlagState[];
    readonly ready: boolean;
    readonly refresh: () => Promise<void>;
}
export declare function FlagsProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function useFlags(): FlagsValue;
export declare function useFlag(id: string): boolean;
export {};
//# sourceMappingURL=flags.d.ts.map