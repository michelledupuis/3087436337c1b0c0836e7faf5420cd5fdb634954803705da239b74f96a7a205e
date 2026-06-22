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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_SHELLS = exports.DEFAULT_ROWS = exports.DEFAULT_COLS = exports.MAX_ROWS = exports.MAX_COLS = exports.MAX_WAIT_MS = exports.SESSION_TIMEOUT_MS = void 0;
exports.selectShell = selectShell;
exports.isValidDimension = isValidDimension;
const path = __importStar(require("path"));
exports.SESSION_TIMEOUT_MS = 30 * 60000;
exports.MAX_WAIT_MS = 5000;
exports.MAX_COLS = 500;
exports.MAX_ROWS = 200;
exports.DEFAULT_COLS = 120;
exports.DEFAULT_ROWS = 40;
exports.ALLOWED_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh']);
function selectShell(shell) {
    if (shell && exports.ALLOWED_SHELLS.has(shell))
        return shell;
    if (shell) {
        const basename = path.basename(shell);
        if (exports.ALLOWED_SHELLS.has(basename))
            return basename;
    }
    const envShell = process.env.SHELL;
    if (envShell) {
        const basename = path.basename(envShell);
        if (exports.ALLOWED_SHELLS.has(basename))
            return basename;
        if (exports.ALLOWED_SHELLS.has(envShell))
            return envShell;
    }
    return 'bash';
}
function isValidDimension(n) {
    return Number.isInteger(n) && n >= 1;
}
