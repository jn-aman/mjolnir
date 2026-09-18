export declare function toEditableYaml(object: unknown): string;
interface YamlEditorProps {
    readonly value: string;
    /** Called with the edited text. Absent means read-only. */
    readonly onApply?: ((text: string) => Promise<void>) | undefined;
    readonly testId?: string;
    /** Opens already editing, for a document that exists to be written. */
    readonly startEditing?: boolean;
    readonly applyLabel?: string;
    readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
}
export declare function YamlEditor({ value, onApply, testId, startEditing, applyLabel, onDirtyChange }: YamlEditorProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=YamlEditor.d.ts.map