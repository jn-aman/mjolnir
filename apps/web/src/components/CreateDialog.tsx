import { useState } from 'react';
import { Modal } from './ui/Modal.tsx';
import { YamlEditor } from './YamlEditor.tsx';

/**
 * `kubectl create -f`, without the file: a skeleton for the kind you are
 * looking at, in the same editor the YAML tab uses, sent when you say so.
 */
interface CreateDialogProps {
  readonly open: boolean;
  readonly kind: string;
  readonly apiVersion: string;
  readonly namespace: string | undefined;
  readonly onClose: () => void;
  readonly onCreate: (yaml: string) => Promise<void>;
}

function skeleton(kind: string, apiVersion: string, namespace: string | undefined): string {
  const meta = ['metadata:', `  name: my-${kind.toLowerCase()}`, ...(namespace !== undefined ? [`  namespace: ${namespace || 'default'}`] : [])];
  return [`apiVersion: ${apiVersion}`, `kind: ${kind}`, ...meta, 'spec: {}', ''].join('\n');
}

export function CreateDialog({ open, kind, apiVersion, namespace, onClose, onCreate }: CreateDialogProps) {
  const [dirty, setDirty] = useState(false);
  const close = () => {
    setDirty(false);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      guard={{ dirty, message: 'The document has changes that were not created.' }}
      title={`Create ${kind}`}
      description="Edit the document, then Create. The server validates it."
      width={780}
      testId="create-dialog"
    >
      <div className="mb-5 flex h-[460px] min-h-0 flex-col overflow-hidden rounded-lg border border-line">
        {open ? (
          <YamlEditor
            key={`${kind}:${namespace ?? ''}`}
            value={skeleton(kind, apiVersion, namespace)}
            startEditing
            applyLabel="Create"
            onApply={async (text) => {
              await onCreate(text);
              setDirty(false);
            }}
            onDirtyChange={setDirty}
            testId="create-editor"
          />
        ) : null}
      </div>
    </Modal>
  );
}
