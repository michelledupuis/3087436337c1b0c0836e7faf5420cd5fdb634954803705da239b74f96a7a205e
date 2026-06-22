#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const pty = __importStar(require("node-pty"));
const node_crypto_1 = require("node:crypto");
const headless_1 = require("@xterm/headless");
const express_1 = __importDefault(require("express"));
const screen_1 = require("./screen");
const config_1 = require("./config");
const DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024;
const SNAPSHOT_INTERVAL_MS = 100;
const DEFAULT_SNAPSHOT_SIZE = 50000;
class InteractiveShellServer {
    constructor(options = {}) {
        this.sessions = new Map();
        this.recentlyExited = new Map();
        this.cleanupInterval = null;
        this.server = new index_js_1.Server({
            name: 'interactive-shell-mcp',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.setupErrorHandling(options.attachProcessHandlers !== false);
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [id, session] of this.sessions) {
                if (now - session.lastActivityTime > config_1.SESSION_TIMEOUT_MS) {
                    this.disposeSession(id);
                }
            }
            for (const [id, info] of this.recentlyExited) {
                if (now - info.exitedAt > 60000)
                    this.recentlyExited.delete(id);
            }
        }, 60000);
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'start_shell_session',
                    description: 'Spawns a new PTY shell with a virtual terminal emulator and returns a unique session ID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cols: { type: 'number', description: 'Terminal columns (default: 120, max: 500)', default: 120 },
                            rows: { type: 'number', description: 'Terminal rows (default: 40, max: 200)', default: 40 },
                            shell: { type: 'string', description: 'Shell to use (bash, zsh, fish, sh, dash, ksh, or full path like /bin/zsh). Defaults to platform shell.' },
                            cwd: { type: 'string', description: 'Working directory for the shell (default: server process cwd)' },
                        },
                        required: [],
                    },
                },
                {
                    name: 'send_shell_input',
                    description: 'Writes input to the PTY. By default appends a carriage return. Use raw mode for interactive prompts (arrow keys, space to toggle, etc.)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: {
                                type: 'string',
                                description: 'The session ID of the shell',
                            },
                            input: {
                                type: 'string',
                                description: 'The input to send to the shell. In raw mode, use escape sequences like \\x1b[A (up), \\x1b[B (down), \\r (enter), space for toggle',
                            },
                            raw: {
                                type: 'boolean',
                                description: 'Send input without appending newline. Interprets escape sequences (\\x1b, \\r, \\n, \\t, \\e). Use for interactive selection prompts, arrow key navigation, etc.',
                                default: false,
                            },
                        },
                        required: ['sessionId', 'input'],
                    },
                },
                {
                    name: 'read_shell_output',
                    description: 'Returns output from the PTY process. Supports three modes: streaming (default) returns buffered output since last read, snapshot mode returns current terminal state, screen mode returns the parsed virtual terminal screen',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: {
                                type: 'string',
                                description: 'The session ID of the shell',
                            },
                            mode: {
                                type: 'string',
                                enum: ['streaming', 'snapshot', 'screen'],
                                description: 'Output mode: streaming (default) for regular commands, snapshot for continuously updating apps like top/htop/airodump-ng, screen for parsed terminal screen contents',
                                default: 'streaming',
                            },
                            maxBytes: {
                                type: 'number',
                                description: 'Maximum bytes to return (default: 100KB, max: 1MB)',
                                default: 102400,
                            },
                            snapshotSize: {
                                type: 'number',
                                description: 'Size of the snapshot buffer to capture (default: 50KB)',
                                default: 50000,
                            },
                            rows: {
                                type: 'number',
                                description: 'Start row for screen mode (0-based, inclusive)',
                            },
                            rowEnd: {
                                type: 'number',
                                description: 'End row for screen mode (exclusive)',
                            },
                            includeEmpty: {
                                type: 'boolean',
                                description: 'Include empty trailing lines in screen mode output (default: true)',
                                default: true,
                            },
                            trimWhitespace: {
                                type: 'boolean',
                                description: 'Trim trailing whitespace from each line in screen mode (default: false)',
                                default: false,
                            },
                            waitForIdle: {
                                type: 'number',
                                description: 'Wait until PTY output is idle for this many ms before reading. Max effective wait is 5000ms even if output keeps arriving. (default: no wait)',
                            },
                        },
                        required: ['sessionId'],
                    },
                },
                {
                    name: 'get_screen_region',
                    description: 'Extracts text from a rectangular region of the terminal screen. Coordinates are 0-based, end values are exclusive.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: { type: 'string', description: 'The session ID of the shell' },
                            startRow: { type: 'number', description: 'Start row (0-based, inclusive)' },
                            startCol: { type: 'number', description: 'Start column (0-based, inclusive)' },
                            endRow: { type: 'number', description: 'End row (exclusive)' },
                            endCol: { type: 'number', description: 'End column (exclusive)' },
                            trimWhitespace: { type: 'boolean', description: 'Trim trailing whitespace from each line (default: false)', default: false },
                            waitForIdle: { type: 'number', description: 'Wait until PTY output is idle for this many ms before reading. Max effective wait is 5000ms even if output keeps arriving. (default: no wait)' },
                        },
                        required: ['sessionId', 'startRow', 'startCol', 'endRow', 'endCol'],
                    },
                },
                {
                    name: 'get_screen_cursor',
                    description: 'Returns the current cursor position and the text of the line the cursor is on. Lightweight alternative to reading the full screen.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: { type: 'string', description: 'The session ID of the shell' },
                            waitForIdle: { type: 'number', description: 'Wait until PTY output is idle for this many ms before reading. Max effective wait is 5000ms even if output keeps arriving. (default: no wait)' },
                        },
                        required: ['sessionId'],
                    },
                },
                {
                    name: 'search_screen',
                    description: 'Search the terminal screen for text or regex pattern. Returns matching positions.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: { type: 'string', description: 'The session ID of the shell' },
                            pattern: { type: 'string', description: 'Text or regex pattern to search for' },
                            regex: { type: 'boolean', description: 'Treat pattern as a regular expression (default: false)', default: false },
                            waitForIdle: { type: 'number', description: 'Wait until PTY output is idle for this many ms before reading. Max effective wait is 5000ms even if output keeps arriving. (default: no wait)' },
                        },
                        required: ['sessionId', 'pattern'],
                    },
                },
                {
                    name: 'list_sessions',
                    description: 'List all active shell sessions with their metadata.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
                {
                    name: 'resize_shell',
                    description: 'Resize the terminal of an active shell session.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: { type: 'string', description: 'The session ID of the shell' },
                            cols: { type: 'number', description: 'New column count (1-500)' },
                            rows: { type: 'number', description: 'New row count (1-200)' },
                        },
                        required: ['sessionId', 'cols', 'rows'],
                    },
                },
                {
                    name: 'end_shell_session',
                    description: 'Closes the PTY and cleans up resources',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            sessionId: {
                                type: 'string',
                                description: 'The session ID of the shell to close',
                            },
                        },
                        required: ['sessionId'],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            try {
                const { name, arguments: args } = request.params;
                switch (name) {
                    case 'start_shell_session':
                        return await this.startShellSession(args?.cols, args?.rows, args?.shell, args?.cwd);
                    case 'send_shell_input': {
                        if (!args || typeof args.sessionId !== 'string' || typeof args.input !== 'string') {
                            throw new Error('Invalid arguments for send_shell_input');
                        }
                        const raw = typeof args.raw === 'boolean' ? args.raw : false;
                        return await this.sendShellInput(args.sessionId, args.input, raw);
                    }
                    case 'read_shell_output':
                        if (!args || typeof args.sessionId !== 'string') {
                            throw new Error('Invalid arguments for read_shell_output');
                        }
                        return await this.readShellOutput(args.sessionId, args.mode, args.maxBytes, args.snapshotSize, args.rows, args.rowEnd, args.includeEmpty, args.trimWhitespace, args.waitForIdle);
                    case 'get_screen_region':
                        if (!args ||
                            typeof args.sessionId !== 'string' ||
                            typeof args.startRow !== 'number' ||
                            typeof args.startCol !== 'number' ||
                            typeof args.endRow !== 'number' ||
                            typeof args.endCol !== 'number') {
                            throw new Error('Invalid arguments for get_screen_region');
                        }
                        return await this.getScreenRegion(args.sessionId, args.startRow, args.startCol, args.endRow, args.endCol, args.trimWhitespace, args.waitForIdle);
                    case 'get_screen_cursor':
                        if (!args || typeof args.sessionId !== 'string') {
                            throw new Error('Invalid arguments for get_screen_cursor');
                        }
                        return await this.getScreenCursor(args.sessionId, args.waitForIdle);
                    case 'search_screen':
                        if (!args || typeof args.sessionId !== 'string' || typeof args.pattern !== 'string') {
                            throw new Error('Invalid arguments for search_screen');
                        }
                        return await this.searchScreenHandler(args.sessionId, args.pattern, args.regex, args.waitForIdle);
                    case 'list_sessions':
                        return this.listSessions();
                    case 'resize_shell':
                        if (!args || typeof args.sessionId !== 'string' || typeof args.cols !== 'number' || typeof args.rows !== 'number') {
                            throw new Error('Invalid arguments for resize_shell');
                        }
                        return await this.resizeShell(args.sessionId, args.cols, args.rows);
                    case 'end_shell_session':
                        if (!args || typeof args.sessionId !== 'string') {
                            throw new Error('Invalid arguments for end_shell_session');
                        }
                        return await this.endShellSession(args.sessionId);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    async startShellSession(cols, rows, shell, cwd) {
        const sessionId = (0, node_crypto_1.randomUUID)();
        const dims = (0, screen_1.clampDimensions)(cols, rows);
        const shellCmd = (0, config_1.selectShell)(shell);
        let ptyProcess;
        try {
            const { MCP_HTTP_AUTH_TOKEN, ...childEnv } = process.env;
            ptyProcess = pty.spawn(shellCmd, [], {
                name: 'xterm-color',
                cols: dims.cols,
                rows: dims.rows,
                cwd: cwd || process.cwd(),
                env: childEnv,
            });
        }
        catch (e) {
            throw new Error(`Failed to start shell '${shellCmd}': ${e instanceof Error ? e.message : String(e)}`);
        }
        const terminal = new headless_1.Terminal({
            cols: dims.cols,
            rows: dims.rows,
            scrollback: 1000,
            allowProposedApi: true,
        });
        const session = {
            id: sessionId,
            shell: shellCmd,
            ptyProcess,
            outputBuffer: '',
            lastSnapshot: '',
            lastSnapshotTime: 0,
            totalBytesReceived: 0,
            maxBufferSize: DEFAULT_MAX_BUFFER_SIZE,
            terminal,
            lastWritePromise: Promise.resolve(),
            lastDataTime: Date.now(),
            lastActivityTime: Date.now(),
            exited: false,
        };
        ptyProcess.onData((data) => {
            const now = Date.now();
            session.lastDataTime = now;
            session.lastActivityTime = now;
            session.totalBytesReceived += data.length;
            if (session.outputBuffer.length + data.length > session.maxBufferSize) {
                const keepSize = Math.max(0, session.maxBufferSize - data.length);
                session.outputBuffer = session.outputBuffer.slice(-keepSize) + data;
            }
            else {
                session.outputBuffer += data;
            }
            if (now - session.lastSnapshotTime >= SNAPSHOT_INTERVAL_MS) {
                session.lastSnapshot = session.outputBuffer.slice(-DEFAULT_SNAPSHOT_SIZE);
                session.lastSnapshotTime = now;
            }
            session.lastWritePromise = (0, screen_1.awaitWrite)(terminal, data);
        });
        ptyProcess.onExit(({ exitCode, signal }) => {
            session.exited = true;
            this.recentlyExited.set(sessionId, { exitCode, signal, exitedAt: Date.now() });
            this.disposeSession(sessionId);
        });
        this.sessions.set(sessionId, session);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ sessionId, cols: dims.cols, rows: dims.rows }),
                },
            ],
        };
    }
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session)
            return session;
        const exited = this.recentlyExited.get(sessionId);
        if (exited) {
            throw new Error(`Session exited with code ${exited.exitCode}${exited.signal ? ` (signal: ${exited.signal})` : ''}`);
        }
        throw new Error(`Invalid session ID: ${sessionId}`);
    }
    async waitForSessionIdle(session, waitForIdle) {
        if (!waitForIdle || waitForIdle <= 0)
            return;
        const idleMs = Math.min(waitForIdle, config_1.MAX_WAIT_MS);
        const startTime = Date.now();
        while (Date.now() - session.lastDataTime < idleMs) {
            if (Date.now() - startTime > config_1.MAX_WAIT_MS)
                break;
            await new Promise(r => setTimeout(r, 50));
        }
        await session.lastWritePromise;
    }
    parseEscapeSequences(input) {
        const escapePattern = /\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\0|\\e|\\r|\\n|\\t|\\\\/g;
        return input.replace(escapePattern, (match, xHex, uHex) => {
            if (xHex)
                return String.fromCharCode(parseInt(xHex, 16));
            if (uHex)
                return String.fromCharCode(parseInt(uHex, 16));
            switch (match) {
                case '\\0': return '\0';
                case '\\e': return '\x1b';
                case '\\r': return '\r';
                case '\\n': return '\n';
                case '\\t': return '\t';
                case '\\\\': return '\\';
                default: return match;
            }
        });
    }
    async sendShellInput(sessionId, input, raw) {
        const session = this.getSession(sessionId);
        if (session.exited) {
            throw new Error('Session has exited — cannot send input');
        }
        session.lastActivityTime = Date.now();
        if (raw) {
            session.ptyProcess.write(this.parseEscapeSequences(input));
        }
        else {
            const inputWithReturn = input.endsWith('\r') || input.endsWith('\n') ? input : input + '\r';
            session.ptyProcess.write(inputWithReturn);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: 'Input sent successfully',
                },
            ],
        };
    }
    detectOutputMode(session) {
        if (session.terminal.buffer.active === session.terminal.buffer.alternate) {
            return 'snapshot';
        }
        const recentOutput = session.outputBuffer.slice(-4096);
        const hasScreenClears = recentOutput.includes('\x1b[2J') || recentOutput.includes('\x1b[3J');
        return hasScreenClears ? 'snapshot' : 'streaming';
    }
    async readShellOutput(sessionId, mode, maxBytes, snapshotSize, startRow, rowEnd, includeEmpty, trimWhitespace, waitForIdle) {
        const session = this.getSession(sessionId);
        session.lastActivityTime = Date.now();
        await this.waitForSessionIdle(session, waitForIdle);
        let outputMode;
        if (mode) {
            outputMode = mode;
        }
        else {
            await session.lastWritePromise;
            outputMode = this.detectOutputMode(session);
        }
        const byteLimit = Math.min(Math.max(1, maxBytes || 102400), DEFAULT_MAX_BUFFER_SIZE);
        const metadata = {
            mode: outputMode,
            totalBytesReceived: session.totalBytesReceived,
        };
        let output;
        if (outputMode === 'screen') {
            await session.lastWritePromise;
            const buf = session.terminal.buffer.active;
            output = (0, screen_1.readScreen)(session.terminal, {
                startRow,
                endRow: rowEnd,
                trimWhitespace: typeof trimWhitespace === 'boolean' ? trimWhitespace : false,
                includeEmpty: typeof includeEmpty === 'boolean' ? includeEmpty : true,
            });
            metadata.cursor = { x: buf.cursorX, y: buf.cursorY };
            metadata.rows = session.terminal.rows;
            metadata.cols = session.terminal.cols;
            metadata.isAlternateBuffer = buf === session.terminal.buffer.alternate;
        }
        else if (outputMode === 'snapshot') {
            const now = Date.now();
            if (now - session.lastSnapshotTime >= SNAPSHOT_INTERVAL_MS || !session.lastSnapshot) {
                const snapSize = Math.max(1, snapshotSize || DEFAULT_SNAPSHOT_SIZE);
                session.lastSnapshot = session.outputBuffer.slice(-snapSize);
                session.lastSnapshotTime = now;
            }
            output = session.lastSnapshot;
            metadata.snapshotTime = session.lastSnapshotTime;
            metadata.isSnapshot = true;
        }
        else {
            output = session.outputBuffer;
            if (output.length > byteLimit) {
                output = output.slice(-byteLimit);
                metadata.truncated = true;
                metadata.originalSize = session.outputBuffer.length;
            }
            session.outputBuffer = '';
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ output, metadata }),
                },
            ],
        };
    }
    async getScreenRegion(sessionId, startRow, startCol, endRow, endCol, trimWhitespace, waitForIdle) {
        const session = this.getSession(sessionId);
        session.lastActivityTime = Date.now();
        await this.waitForSessionIdle(session, waitForIdle);
        await session.lastWritePromise;
        const output = (0, screen_1.readScreenRegion)(session.terminal, startRow, startCol, endRow, endCol, trimWhitespace);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ output, region: { startRow, startCol, endRow, endCol } }),
                },
            ],
        };
    }
    async getScreenCursor(sessionId, waitForIdle) {
        const session = this.getSession(sessionId);
        session.lastActivityTime = Date.now();
        await this.waitForSessionIdle(session, waitForIdle);
        await session.lastWritePromise;
        const buf = session.terminal.buffer.active;
        const cursorLine = buf.getLine(buf.viewportY + buf.cursorY);
        const currentLine = cursorLine ? cursorLine.translateToString(true) : '';
        const isAlternateBuffer = buf === session.terminal.buffer.alternate;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ cursor: { x: buf.cursorX, y: buf.cursorY }, currentLine, isAlternateBuffer }),
                },
            ],
        };
    }
    async searchScreenHandler(sessionId, pattern, regex, waitForIdle) {
        const session = this.getSession(sessionId);
        session.lastActivityTime = Date.now();
        await this.waitForSessionIdle(session, waitForIdle);
        await session.lastWritePromise;
        const results = (0, screen_1.searchScreen)(session.terminal, pattern, regex);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ results, count: results.length }),
                },
            ],
        };
    }
    listSessions() {
        const now = Date.now();
        const sessions = [];
        for (const session of this.sessions.values()) {
            sessions.push({
                sessionId: session.id,
                shell: session.shell,
                cols: session.terminal.cols,
                rows: session.terminal.rows,
                isAlternateBuffer: session.terminal.buffer.active === session.terminal.buffer.alternate,
                idleSeconds: Math.floor((now - session.lastActivityTime) / 1000),
            });
        }
        return { content: [{ type: 'text', text: JSON.stringify({ sessions }) }] };
    }
    async resizeShell(sessionId, cols, rows) {
        const session = this.getSession(sessionId);
        if (session.exited) {
            throw new Error('Session has exited — cannot resize');
        }
        if (!Number.isInteger(cols) || cols < 1)
            throw new Error(`cols must be a positive integer, got ${cols}`);
        if (!Number.isInteger(rows) || rows < 1)
            throw new Error(`rows must be a positive integer, got ${rows}`);
        const c = Math.min(cols, config_1.MAX_COLS);
        const r = Math.min(rows, config_1.MAX_ROWS);
        session.ptyProcess.resize(c, r);
        session.terminal.resize(c, r);
        session.lastActivityTime = Date.now();
        return { content: [{ type: 'text', text: JSON.stringify({ cols: c, rows: r }) }] };
    }
    disposeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        this.sessions.delete(sessionId);
        try {
            session.terminal.dispose();
        }
        catch (_) { }
        if (!session.exited) {
            try {
                session.ptyProcess.kill();
            }
            catch (_) { }
        }
    }
    async endShellSession(sessionId) {
        if (!this.sessions.has(sessionId) && !this.recentlyExited.has(sessionId)) {
            throw new Error(`Invalid session ID: ${sessionId}`);
        }
        this.disposeSession(sessionId);
        this.recentlyExited.delete(sessionId);
        return {
            content: [
                {
                    type: 'text',
                    text: 'Session ended successfully',
                },
            ],
        };
    }
    setupErrorHandling(attachProcessHandlers = true) {
        this.server.onerror = (error) => {
            console.error('[MCP Error]', error);
        };
        if (!attachProcessHandlers)
            return;
        process.on('SIGINT', async () => {
            await this.cleanup();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            await this.cleanup();
            process.exit(0);
        });
    }
    async cleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        for (const sessionId of [...this.sessions.keys()]) {
            this.disposeSession(sessionId);
        }
    }
    getServer() {
        return this.server;
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('Interactive Shell MCP server running on stdio');
    }
}
const HTTP_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const HTTP_IDLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
async function runHttp(opts) {
    const { host, port, endpoint, authToken } = opts;
    if (!authToken) {
        console.error('[HTTP] ERROR: no auth token set. Set MCP_HTTP_AUTH_TOKEN or pass --auth-token. Refusing to start without auth.');
        process.exit(1);
    }
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: '10mb' }));
    const sessions = new Map();
    const requireAuth = (req, res, next) => {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${authToken}`) {
            res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
            return;
        }
        next();
    };
    const log = (msg) => {
        const ts = new Date().toISOString();
        console.error(`[HTTP ${ts}] ${msg}`);
    };
    const sweepInterval = setInterval(() => {
        const now = Date.now();
        for (const [sid, entry] of sessions) {
            if (now - entry.lastActivity > HTTP_IDLE_TIMEOUT_MS) {
                log(`Session ${sid} idle timeout - disposing`);
                entry.transport.close().catch(() => { });
                entry.shellServer.cleanup().catch(() => { });
                sessions.delete(sid);
            }
        }
    }, HTTP_IDLE_SWEEP_INTERVAL_MS);
    const cleanupAll = async () => {
        clearInterval(sweepInterval);
        for (const [sid, entry] of sessions) {
            try {
                await entry.transport.close();
            }
            catch (_) { }
            try {
                await entry.shellServer.cleanup();
            }
            catch (_) { }
        }
        sessions.clear();
    };
    app.post(endpoint, requireAuth, async (req, res) => {
        const sessionIdHeader = req.headers['mcp-session-id'];
        const body = req.body;
        const isInitialize = body && body.method === 'initialize';
        let shellServer = null;
        let transport = null;
        let initializedSessionId = null;
        try {
            if (isInitialize) {
                shellServer = new InteractiveShellServer({ attachProcessHandlers: false });
                transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
                    sessionIdGenerator: () => (0, node_crypto_1.randomUUID)(),
                    onsessioninitialized: (sid) => {
                        initializedSessionId = sid;
                        sessions.set(sid, { shellServer: shellServer, transport: transport, createdAt: Date.now(), lastActivity: Date.now() });
                        log(`Session initialized: ${sid}`);
                    },
                });
                await shellServer.getServer().connect(transport);
                await transport.handleRequest(req, res, body);
                return;
            }
            if (!sessionIdHeader) {
                res.status(400).json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32600, message: 'Missing Mcp-Session-Id header' } });
                return;
            }
            const entry = sessions.get(sessionIdHeader);
            if (!entry) {
                res.status(404).json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32001, message: 'Session not found or expired' } });
                return;
            }
            entry.lastActivity = Date.now();
            log(`POST sid=${sessionIdHeader} method=${body?.method ?? '?'}`);
            await entry.transport.handleRequest(req, res, body);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`POST error: ${msg}`);
            if (initializedSessionId && sessions.has(initializedSessionId)) {
                sessions.delete(initializedSessionId);
            }
            if (shellServer) {
                shellServer.cleanup().catch(() => { });
            }
            if (transport) {
                transport.close().catch(() => { });
            }
            if (!res.headersSent) {
                res.status(500).json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32603, message: msg } });
            }
        }
    });
    app.get(endpoint, requireAuth, async (req, res) => {
        const sessionIdHeader = req.headers['mcp-session-id'];
        if (!sessionIdHeader) {
            res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Missing Mcp-Session-Id header' } });
            return;
        }
        const entry = sessions.get(sessionIdHeader);
        if (!entry) {
            res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found or expired' } });
            return;
        }
        entry.lastActivity = Date.now();
        log(`GET (SSE) sid=${sessionIdHeader}`);
        try {
            await entry.transport.handleRequest(req, res);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`GET error: ${msg}`);
            if (!res.headersSent) {
                res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: msg } });
            }
        }
    });
    app.delete(endpoint, requireAuth, async (req, res) => {
        const sessionIdHeader = req.headers['mcp-session-id'];
        if (!sessionIdHeader) {
            res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Missing Mcp-Session-Id header' } });
            return;
        }
        const entry = sessions.get(sessionIdHeader);
        if (!entry) {
            res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found or expired' } });
            return;
        }
        try {
            await entry.transport.handleRequest(req, res);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`DELETE error: ${msg}`);
            if (!res.headersSent) {
                res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: msg } });
            }
        }
        try {
            await entry.shellServer.cleanup();
        }
        catch (_) { }
        sessions.delete(sessionIdHeader);
        log(`Session terminated: ${sessionIdHeader}`);
    });
    let shuttingDown = false;
    const shutdown = async (sig) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        log(`${sig} received - shutting down ${sessions.size} session(s)`);
        await cleanupAll();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    await new Promise((resolve, reject) => {
        let resolved = false;
        const httpServer = app.listen(port, host, () => {
            log(`Interactive Shell MCP server running on http://${host}:${port}${endpoint}`);
            log('Auth: bearer token required');
            resolved = true;
            resolve();
        });
        httpServer.on('error', (err) => {
            const code = err.code ?? 'UNKNOWN';
            let hint = '';
            if (code === 'EADDRINUSE') {
                hint = ` (port ${port} is already in use - pass a different --port)`;
            }
            else if (code === 'EACCES') {
                hint = ` (port ${port} requires administrator privileges - use a port >= 1024)`;
            }
            else if (code === 'EADDRNOTAVAIL') {
                hint = ` (host ${host} is not available on this machine - try --host 0.0.0.0)`;
            }
            log(`HTTP server error [${code}]: ${err.message}${hint}`);
            try {
                httpServer.close();
            }
            catch (_) { }
            void cleanupAll();
            if (resolved) {
                process.exit(1);
            }
            else {
                reject(err);
            }
        });
    });
}
function printHelp() {
    console.error(`
Interactive Shell MCP server
Usage: node server.js [options]
Options:
  --transport <stdio|http>  Transport to use (default: stdio)
  --host <addr>             HTTP host (default: 127.0.0.1, use 0.0.0.0 for all)
  --port <n>                HTTP port (default: 8808)
  --endpoint <path>         HTTP endpoint path (default: /mcp)
  --auth-token <token>      Bearer token for HTTP auth (or set MCP_HTTP_AUTH_TOKEN env var)
  --help, -h                Show this help
Examples:
  # stdio (default, for Claude Desktop / Cursor local spawn)
  node server.js
  # HTTP with bearer auth on localhost
  MCP_HTTP_AUTH_TOKEN=secret node server.js --transport http --host 127.0.0.1 --port 8808
  # HTTP on all interfaces, behind a reverse proxy / tunnel
  MCP_HTTP_AUTH_TOKEN=secret node server.js --transport http --host 0.0.0.0 --port 8808
`);
}
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        transport: 'stdio',
        host: '127.0.0.1',
        port: 8808,
        endpoint: '/mcp',
        authToken: process.env.MCP_HTTP_AUTH_TOKEN,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = () => {
            const v = args[++i];
            if (v === undefined) {
                console.error(`Error: missing value for ${arg}`);
                process.exit(2);
            }
            return v;
        };
        switch (arg) {
            case '--transport': {
                const v = next();
                if (v !== 'stdio' && v !== 'http') {
                    console.error(`Error: --transport must be 'stdio' or 'http', got '${v}'`);
                    process.exit(2);
                }
                result.transport = v;
                break;
            }
            case '--host':
                result.host = next();
                break;
            case '--port': {
                const v = next();
                const parsed = parseInt(v, 10);
                if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
                    console.error(`Error: --port must be an integer between 1 and 65535, got '${v}'`);
                    process.exit(2);
                }
                result.port = parsed;
                break;
            }
            case '--endpoint':
                result.endpoint = next();
                break;
            case '--auth-token':
                result.authToken = next();
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
            default:
                console.error(`Unknown argument: ${arg}\n`);
                printHelp();
                process.exit(2);
        }
    }
    return result;
}
const cliArgs = parseArgs();
if (cliArgs.transport === 'http') {
    runHttp(cliArgs).catch((err) => {
        console.error('Failed to start HTTP server:', err);
        process.exit(1);
    });
}
else {
    const server = new InteractiveShellServer();
    server.run().catch(console.error);
}
