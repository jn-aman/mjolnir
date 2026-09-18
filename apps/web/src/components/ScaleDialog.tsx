import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal.tsx';
import { Minus, Plus } from 'lucide-react';
import { Button } from './ui/Button.tsx';
import type { KubeItem } from './columns.tsx';

/**
 * Scale a workload.
 *
 * A number, two nudge buttons, and the current value shown so the change is a
 * change and not a guess. Zero is allowed, scaling to zero is how you stop a
 * workload without deleting it, but it is called out, because it is usually
 * not what a slip of the finger meant.
 */
interface ScaleDialogProps {
  readonly item: KubeItem | null;
  readonly kind: string;
  readonly onClose: () => void;
  readonly onScale: (replicas: number) => Promise<void>;
}

export function ScaleDialog({ item, kind, onClose, onScale }: ScaleDialogProps) {
  const current = typeof item?.spec?.['replicas'] === 'number' ? (item.spec['replicas'] as number) : 1;
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(current), [current, item]);

  const submit = async () => {
    setBusy(true);
    try {
      await onScale(value);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title={`Scale ${kind.toLowerCase()}`}
      description={<span className="font-mono">{item?.metadata?.name} · currently {current}</span>}
      width={380}
      testId="scale-dialog"
      guard={{ dirty: value !== current, message: `Replicas changed to ${value} but not applied.` }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" data-testid="scale-apply" disabled={busy || value === current} onClick={() => void submit()}>
            {busy ? 'Scaling…' : `Scale to ${value}`}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-center gap-3 pb-1">
        <Button iconOnly aria-label="Fewer" disabled={value <= 0} onClick={() => setValue((v) => Math.max(0, v - 1))} icon={<Minus size={14} strokeWidth={2} />} />
        <input
          type="number"
          min={0}
          value={value}
          onChange={(event) => setValue(Math.max(0, Number(event.target.value) || 0))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
          aria-label="Replicas"
          data-testid="scale-input"
          className="h-[44px] w-[96px] rounded-lg border border-line bg-sunken text-center font-mono text-[20px] tabular-nums text-primary outline-none focus:border-focus"
        />
        <Button iconOnly aria-label="More" onClick={() => setValue((v) => v + 1)} icon={<Plus size={14} strokeWidth={2} />} />
      </div>
      {value === 0 ? (
        <p className="mt-3 text-center text-[12px] text-warn">Zero replicas stops the workload. Its pods will be removed.</p>
      ) : null}
    </Modal>
  );
}
