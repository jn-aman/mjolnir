import type { ToolDefinition } from '../lib/tools.ts';
/**
 * The page a planned tool opens to.
 *
 * It says what the tool will do and gives the command that does it today, so
 * the slot is useful before the feature is. It does not pretend: no empty
 * table, no disabled buttons dressed as a preview.
 */
export declare function ToolPanel({ tool, section }: {
    readonly tool: ToolDefinition;
    readonly section?: string | undefined;
}): import("react").JSX.Element;
//# sourceMappingURL=ToolPanel.d.ts.map