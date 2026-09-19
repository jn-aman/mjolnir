import type { CSSProperties, ReactNode } from 'react';
/**
 * The two screens nobody designs, and everybody sees.
 *
 * "No job in this cluster." set in grey in the middle of two thousand empty
 * pixels is not a neutral choice: it reads as a dead end, when the true
 * message is almost always "this worked, and the answer is none". So an empty
 * state names what was looked for, says why nothing is wrong, and offers the
 * next move.
 *
 * Loading is the same problem pointed the other way. A spinner in the middle
 * of a white rectangle says "wait" and nothing else, and it throws away the one
 * useful thing a loading screen can do, which is show the shape of what is
 * coming so the page does not jump when it arrives. So the skeleton is the
 * hero here and the status is a small lit badge floating over it, the way the
 * app itself is laid out.
 */
export declare function EmptyState({ title, detail, icon, action, testId, tone, }: {
    title: string;
    detail?: ReactNode;
    /** Replaces the mark, for a state that is about one kind of thing. */
    icon?: ReactNode;
    action?: ReactNode;
    testId?: string;
    tone?: 'muted' | 'error';
}): import("react").JSX.Element;
export declare function LoadingState({ title, detail, rows, testId, }: {
    title?: string;
    detail?: ReactNode;
    /** 0 for a panel, where a fake table would be a lie about the layout. */
    rows?: number;
    testId?: string;
}): import("react").JSX.Element;
/** A bar that catches the light as it passes, rather than blinking on and off. */
export declare function Shimmer({ className, style, delay }: {
    className?: string;
    style?: CSSProperties;
    delay?: number;
}): import("react").JSX.Element;
//# sourceMappingURL=States.d.ts.map