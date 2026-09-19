export type EditorLanguage = 'yaml' | 'json' | 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'markdown' | 'python' | 'go' | 'html' | 'css' | 'xml' | 'sql' | 'rust' | 'shell' | 'toml' | 'properties' | 'dockerfile' | 'nginx' | 'plain';
/** The language for a file name, by its extension. */
export declare function languageFor(name: string): EditorLanguage;
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
    /** Hands the caller apply and discard, so a guard elsewhere can offer Save. */
    readonly controller?: ((api: {
        apply: () => Promise<void>;
        discard: () => void;
    }) => void) | undefined;
    readonly language?: EditorLanguage;
    /** Soft-wrap long lines (logs, prose). */
    readonly wrap?: boolean;
}
export declare function YamlEditor({ value, onApply, testId, startEditing, applyLabel, onDirtyChange, controller, language, wrap }: YamlEditorProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=YamlEditor.d.ts.map