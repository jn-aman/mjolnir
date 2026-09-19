/**
 * Any object, viewed in place.
 *
 * Code and text get the editor with the language for their extension,
 * images, PDF, video and audio use the browser's own renderers through the
 * server's streaming route, and everything else gets a hex dump of its
 * first bytes, so nothing is ever "no preview".
 */
interface FileViewerProps {
    readonly file: {
        key: string;
        type: string;
        size: number;
    } | null;
    /** Streams the object through the server; `inline` limits to the first bytes. */
    readonly urlFor: (key: string, inline: boolean) => string;
    readonly onPresign: (key: string) => Promise<string>;
    readonly onClose: () => void;
}
export declare function FileViewer({ file, urlFor, onPresign, onClose }: FileViewerProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=FileViewer.d.ts.map