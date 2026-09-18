import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Modal } from './ui/Modal.tsx';
import { Button } from './ui/Button.tsx';
import { Field } from './ui/Field.tsx';
import { Select } from './ui/Select.tsx';
import type { KubeItem } from './columns.tsx';
import type { Taint } from '../lib/edits.ts';

/** `kubectl taint`, as a list you edit rather than a syntax you remember. */
interface TaintDialogProps {
  readonly node: KubeItem | null;
  readonly onClose: () => void;
  readonly onApply: (taints: readonly Taint[]) => Promise<void>;
}

const EFFECTS: Array<{ value: Taint['effect']; label: string; hint: string }> = [
  { value: 'NoSchedule', label: 'NoSchedule', hint: 'new pods without a toleration will not land here' },
  { value: 'PreferNoSchedule', label: 'PreferNoSchedule', hint: 'avoided, not forbidden' },
  { value: 'NoExecute', label: 'NoExecute', hint: 'running pods without a toleration are evicted' },
];

export function TaintDialog({ node, onClose, onApply }: TaintDialogProps) {
  const existing = ((node?.spec as { taints?: Taint[] } | undefined)?.taints ?? []) as Taint[];
  const [taints, setTaints] = useState<Taint[]>(existing);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [effect, setEffect] = useState<Taint['effect']>('NoSchedule');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTaints(existing);
    // A new node means a new list; the existing array is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);

  const add = () => {
    const k = key.trim();
    if (!k) return;
    setTaints((current) => [...current.filter((t) => !(t.key === k && t.effect === effect)), { key: k, ...(value.trim() ? { value: value.trim() } : {}), effect }]);
    setKey('');
    setValue('');
  };

  const apply = async () => {
    setBusy(true);
    try {
      await onApply(taints);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={node !== null}
      onClose={onClose}
      title="Taints"
      description={<span className="font-mono">{node?.metadata?.name}</span>}
      width={520}
      testId="taint-dialog"
      guard={{ dirty: JSON.stringify(taints) !== JSON.stringify(existing), message: 'Taint changes were not applied.' }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" data-testid="taint-apply" disabled={busy} onClick={() => void apply()}>
            {busy ? 'Applying…' : 'Apply'}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5" data-testid="taint-list">
        {taints.length === 0 ? <span className="text-[12px] text-tertiary">No taints. Every pod may schedule here.</span> : null}
        {taints.map((taint) => (
          <span
            key={`${taint.key}:${taint.effect}`}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-overlay py-[3px] pl-2 pr-1 font-mono text-[11px]"
          >
            <span className="text-primary">{taint.key}</span>
            {taint.value ? <span className="text-secondary">={taint.value}</span> : null}
            <span className="text-warn">:{taint.effect}</span>
            <button
              type="button"
              aria-label={`Remove ${taint.key}`}
              onClick={() => setTaints((current) => current.filter((t) => t !== taint))}
              className="ml-0.5 rounded-xs p-[1px] text-tertiary hover:bg-error-bg hover:text-error"
            >
              <X size={11} strokeWidth={2.4} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-end gap-2">
        <Field id="taint-key" label="Key" mono value={key} onChange={(e) => setKey(e.target.value)} placeholder="dedicated" className="flex-1" />
        <Field id="taint-value" label="Value" mono value={value} onChange={(e) => setValue(e.target.value)} placeholder="gpu" className="flex-1" />
        <Select
          label="Effect"
          value={effect}
          onChange={(next) => setEffect(next as Taint['effect'])}
          options={EFFECTS}
        />
        <Button onClick={add} icon={<Plus size={13} strokeWidth={2} />} aria-label="Add taint">
          Add
        </Button>
      </div>
    </Modal>
  );
}
