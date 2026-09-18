/**
 * "You changed this and clicked away." The one rule for every inline editor:
 * nothing changed, it just closes; something changed, this asks, right where
 * the edit was, and nothing is lost until the person says so.
 */
export declare function AskSave({ what, onSave, onDiscard, busy }: {
    what: string;
    onSave: () => void;
    onDiscard: () => void;
    busy?: boolean;
}): import("react").JSX.Element;
//# sourceMappingURL=AskSave.d.ts.map