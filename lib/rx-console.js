import { LogLevel } from '@obsidize/rx-console';
import { SecureLogger } from './cordova-plugin-secure-logger';
function remapWebViewLogLevel(level) {
    switch (level) {
        case LogLevel.VERBOSE: return 2 /* SecureLogLevel.VERBOSE */;
        case LogLevel.TRACE: return 2 /* SecureLogLevel.VERBOSE */;
        case LogLevel.DEBUG: return 3 /* SecureLogLevel.DEBUG */;
        case LogLevel.INFO: return 4 /* SecureLogLevel.INFO */;
        case LogLevel.WARN: return 5 /* SecureLogLevel.WARN */;
        case LogLevel.ERROR: return 6 /* SecureLogLevel.ERROR */;
        case LogLevel.FATAL: return 7 /* SecureLogLevel.FATAL */;
        default: return 2 /* SecureLogLevel.VERBOSE */;
    }
}
/**
 * Converts the given rx-console event to a native event,
 * add adds it to the SecureLogger flush queue.
 */
export function sendRxConsoleEventToNative(ev) {
    SecureLogger.queueEvent({
        level: remapWebViewLogLevel(ev.level),
        timestamp: ev.timestamp,
        tag: ev.tag,
        message: ev.message
    });
}
