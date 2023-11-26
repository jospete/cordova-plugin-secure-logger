"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRxConsoleEventToNative = exports.remapLogLevel = void 0;
var rx_console_1 = require("@obsidize/rx-console");
var cordova_plugin_secure_logger_1 = require("./cordova-plugin-secure-logger");
function remapLogLevel(level) {
    switch (level) {
        case rx_console_1.LogLevel.VERBOSE: return 2 /* SecureLogLevel.VERBOSE */;
        case rx_console_1.LogLevel.TRACE: return 2 /* SecureLogLevel.VERBOSE */;
        case rx_console_1.LogLevel.DEBUG: return 3 /* SecureLogLevel.DEBUG */;
        case rx_console_1.LogLevel.INFO: return 4 /* SecureLogLevel.INFO */;
        case rx_console_1.LogLevel.WARN: return 5 /* SecureLogLevel.WARN */;
        case rx_console_1.LogLevel.ERROR: return 6 /* SecureLogLevel.ERROR */;
        case rx_console_1.LogLevel.FATAL: return 7 /* SecureLogLevel.FATAL */;
        default: return 2 /* SecureLogLevel.VERBOSE */;
    }
}
exports.remapLogLevel = remapLogLevel;
function sendRxConsoleEventToNative(ev) {
    cordova_plugin_secure_logger_1.SecureLogger.queueEvent({
        level: remapLogLevel(ev.level),
        timestamp: ev.timestamp,
        tag: ev.tag,
        message: ev.message
    });
}
exports.sendRxConsoleEventToNative = sendRxConsoleEventToNative;
