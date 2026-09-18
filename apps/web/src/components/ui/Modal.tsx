import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button.tsx';

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
  readonly guard?: { readonly dirty: boolean; readonly message?: string } | undefined;
}

export function Modal({ open, onClose, title, description, children, footer, width = 420, testId, guard }: ModalProps) {
  const [confirming, setConfirming] = useState(false);
  const requestClose = () => {
    if (guard?.dirty) setConfirming(true);
    else onClose();
  };
  const discard = () => {
    setConfirming(false);
    onClose();
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="mjolnir-overlay fixed inset-0 z-40 bg-[rgba(4,6,12,0.5)]" />
        <Dialog.Content
          data-testid={testId}
          className="mjolnir-modal fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100%-48px)] max-w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-overlay shadow-[var(--shadow-lg)]"
          style={{ width }}
        >
          <div className="shrink-0 px-5 pt-5">
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="modal-close"
                onClick={(event) => {
                  event.preventDefault();
                  requestClose();
                }}
                className="absolute right-3 top-3 rounded-md p-1.5 text-tertiary transition-colors duration-100 hover:bg-hover hover:text-primary"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </Dialog.Close>
            <Dialog.Title className="pr-8 text-[14px] font-semibold text-primary">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-1 text-[12px] text-secondary">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          {children ? <div className="flex min-h-0 flex-1 flex-col px-5 pt-4">{children}</div> : null}
          {confirming ? (
            <div
              data-testid="modal-discard"
              className="mx-5 mb-4 flex items-center gap-3 rounded-lg border border-[var(--status-warn)] bg-warn-bg px-3 py-2"
              style={{ animation: 'mjolnir-menu-in 140ms cubic-bezier(0.16, 1, 0.3, 1)' }}
            >
              <span className="text-[12px] text-warn">{guard?.message ?? 'You have unsaved changes.'}</span>
              <div className="flex-1" />
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep editing
              </Button>
              <Button variant="danger" data-testid="modal-discard-confirm" onClick={discard}>
                Discard
              </Button>
            </div>
          ) : null}
          {footer ? <div className="flex shrink-0 justify-end gap-2 px-5 pb-5 pt-4">{footer}</div> : <div className="pb-5" />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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

export function ConfirmDialog({ open, title, body, confirmLabel, danger = false, busy = false, onConfirm, onClose, testId }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      testId={testId}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} data-testid="confirm" disabled={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    />
  );
}
