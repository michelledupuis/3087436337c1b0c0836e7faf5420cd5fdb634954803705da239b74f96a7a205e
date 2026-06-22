import { Terminal } from '@xterm/headless';
export declare function awaitWrite(terminal: Terminal, data: string): Promise<void>;
export interface ReadScreenOptions {
    startRow?: number;
    endRow?: number;
    trimWhitespace?: boolean;
    includeEmpty?: boolean;
}
export declare function readScreen(terminal: Terminal, options?: ReadScreenOptions): string;
export interface ScreenRegion {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
}
export declare function validateRegion(terminal: Terminal, startRow: number, startCol: number, endRow: number, endCol: number): ScreenRegion;
export declare function readScreenRegion(terminal: Terminal, startRow: number, startCol: number, endRow: number, endCol: number, trimWhitespace?: boolean): string;
export interface SearchResult {
    row: number;
    col: number;
    text: string;
}
export declare function searchScreen(terminal: Terminal, pattern: string, isRegex?: boolean): SearchResult[];
export declare function clampDimensions(cols?: number, rows?: number): {
    cols: number;
    rows: number;
};
