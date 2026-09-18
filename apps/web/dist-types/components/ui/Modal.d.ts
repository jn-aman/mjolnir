import type { ReactNode } from 'react';
/**
 * The dialog frame, once. Title, an optional sentence, the body, a footer.
 * Every dialog in the app is this with different contents, so they all open
 * the same way, sit in the same place and close on the same keys.
 */
interface ModalProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    readonly description?: ReactNode;
    readonly children?: ReactNode;
    readonly footer?: ReactNode;
    readonly width?: number;
    readonly testId?: string | undefined;
    /**
     * Unsaved work. While `dirty`, closing by ×, Escape or the overlay asks
     * first, inline, not as a second dialog on top of the first.
     */
    readonly guard?: {
        readonly dirty: boolean;
        readonly message?: string;
    } | undefined;
}
export declare function Modal({ open, onClose, title, description, children, footer, width, testId, guard }: ModalProps): import("react").JSX.Element;
interface ConfirmProps {
    readonly open: boolean;
    readonly title: string;
    readonly body: ReactNode;
    readonly confirmLabel: string;
    readonly danger?: boolean;
    readonly busy?: boolean;
    readonly onConfirm: () => void;
    readonly onClose: () => void;
    readonly testId?: string | undefined;
}
export declare function ConfirmDialog({ open, title, body, confirmLabel, danger, busy, onConfirm, onClose, testId }: ConfirmProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Modal.d.ts.map