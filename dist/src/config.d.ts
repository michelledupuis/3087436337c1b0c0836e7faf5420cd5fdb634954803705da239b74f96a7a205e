export declare const SESSION_TIMEOUT_MS: number;
export declare const MAX_WAIT_MS = 5000;
export declare const MAX_COLS = 500;
export declare const MAX_ROWS = 200;
export declare const DEFAULT_COLS = 120;
export declare const DEFAULT_ROWS = 40;
export declare const ALLOWED_SHELLS: Set<string>;
export declare function selectShell(shell?: string): string;
export declare function isValidDimension(n: number): boolean;
