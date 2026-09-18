/**
 * A workload's state in one word.
 *
 * The mapping is the interesting part, not the styling:
 *
 * - **Completed is neutral, not ok.** A Job that finished is not healthy, it is
 *   done. Colouring it green trains people to read green as "nothing to see",
 *   which is exactly wrong on the day a Job completes when it should still be
 *   running.
 * - **Unknown is neutral, not error.** We do not know. Red would be a claim we
 *   cannot support.
 * - The Kubernetes string is shown verbatim, because that is what people search
 *   for and paste into a terminal.
 */
export type StatusTone = 'ok' | 'warn' | 'error' | 'neutral';
export declare function toneFor(status: string): StatusTone;
interface StatusChipProps {
    readonly status: string;
    readonly tone?: StatusTone;
}
export declare function StatusChip({ status, tone }: StatusChipProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=StatusChip.d.ts.map