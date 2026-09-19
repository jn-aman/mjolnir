import { type ReactNode } from 'react';
/**
 * A cell that shows its whole value when the column is too narrow for it.
 *
 * Wrapping was the wrong answer: one container called
 * `k8s_local-path-provisioner_local-path-provisioner-5db9d5cbbb-rlv8d_kube-system_…_0`
 * turns every row in the table into three, and a table whose row height depends
 * on its worst string is not a table any more. Cutting it without a way back is
 * the other wrong answer.
 *
 * So cells clip to one line, and hovering one that is clipped shows the value
 * in full, selectable, wrapped, wide. The tooltip appears only when something
 * is genuinely hidden, which is measured at hover rather than guessed from a
 * character count, so a wide window simply never shows one. Nothing is
 * computed while scrolling; the measurement happens on the cell under the
 * pointer and nowhere else.
 */
export declare function OverflowTip({ children, className, testId, align, mono, }: {
    children: ReactNode;
    className?: string;
    testId?: string;
    align?: 'start' | 'end';
    mono?: boolean;
}): import("react").JSX.Element;
//# sourceMappingURL=OverflowTip.d.ts.map