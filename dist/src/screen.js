"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.awaitWrite = awaitWrite;
exports.readScreen = readScreen;
exports.validateRegion = validateRegion;
exports.readScreenRegion = readScreenRegion;
exports.searchScreen = searchScreen;
exports.clampDimensions = clampDimensions;
const config_1 = require("./config");
function awaitWrite(terminal, data) {
    return new Promise((resolve) => terminal.write(data, resolve));
}
function readScreen(terminal, options) {
    const buffer = terminal.buffer.active;
    const viewportStart = buffer.viewportY;
    const startRow = Math.max(0, Math.min(options?.startRow ?? 0, terminal.rows));
    const endRow = Math.max(0, Math.min(options?.endRow ?? terminal.rows, terminal.rows));
    const trim = options?.trimWhitespace ?? false;
    const lines = [];
    for (let y = startRow; y < endRow; y++) {
        const line = buffer.getLine(viewportStart + y);
        lines.push(line?.translateToString(trim) ?? '');
    }
    if (options?.includeEmpty === false) {
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }
    }
    return lines.join('\n');
}
function validateRegion(terminal, startRow, startCol, endRow, endCol) {
    if (endRow < startRow) {
        throw new Error(`endRow (${endRow}) must be >= startRow (${startRow})`);
    }
    if (endCol < startCol) {
        throw new Error(`endCol (${endCol}) must be >= startCol (${startCol})`);
    }
    return {
        startRow: Math.max(0, Math.min(startRow, terminal.rows)),
        startCol: Math.max(0, Math.min(startCol, terminal.cols)),
        endRow: Math.max(0, Math.min(endRow, terminal.rows)),
        endCol: Math.max(0, Math.min(endCol, terminal.cols)),
    };
}
function readScreenRegion(terminal, startRow, startCol, endRow, endCol, trimWhitespace) {
    const region = validateRegion(terminal, startRow, startCol, endRow, endCol);
    const buffer = terminal.buffer.active;
    const viewportStart = buffer.viewportY;
    const lines = [];
    for (let y = region.startRow; y < region.endRow; y++) {
        const line = buffer.getLine(viewportStart + y);
        lines.push(line?.translateToString(trimWhitespace ?? false, region.startCol, region.endCol) ?? '');
    }
    return lines.join('\n');
}
const MAX_SEARCH_RESULTS = 50;
const MAX_PATTERN_LENGTH = 200;
function searchScreen(terminal, pattern, isRegex) {
    if (!pattern || pattern.length === 0) {
        throw new Error('Pattern must not be empty');
    }
    if (pattern.length > MAX_PATTERN_LENGTH) {
        throw new Error(`Pattern too long: max ${MAX_PATTERN_LENGTH} characters`);
    }
    let regex;
    if (isRegex) {
        try {
            regex = new RegExp(pattern, 'g');
        }
        catch {
            throw new Error(`Invalid regex pattern: ${pattern}`);
        }
    }
    const buffer = terminal.buffer.active;
    const viewportStart = buffer.viewportY;
    const results = [];
    for (let y = 0; y < terminal.rows && results.length < MAX_SEARCH_RESULTS; y++) {
        const line = buffer.getLine(viewportStart + y);
        if (!line)
            continue;
        const text = line.translateToString(true);
        if (regex) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(text)) !== null && results.length < MAX_SEARCH_RESULTS) {
                results.push({ row: y, col: match.index, text: match[0] });
                if (match[0].length === 0) {
                    regex.lastIndex++;
                }
            }
        }
        else {
            let startIdx = 0;
            let idx;
            while ((idx = text.indexOf(pattern, startIdx)) !== -1 && results.length < MAX_SEARCH_RESULTS) {
                results.push({ row: y, col: idx, text: pattern });
                startIdx = idx + 1;
            }
        }
    }
    return results;
}
function clampDimensions(cols, rows) {
    return {
        cols: typeof cols === 'number' && (0, config_1.isValidDimension)(cols) ? Math.min(cols, config_1.MAX_COLS) : config_1.DEFAULT_COLS,
        rows: typeof rows === 'number' && (0, config_1.isValidDimension)(rows) ? Math.min(rows, config_1.MAX_ROWS) : config_1.DEFAULT_ROWS,
    };
}
