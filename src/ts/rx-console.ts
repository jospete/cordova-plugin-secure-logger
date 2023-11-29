import { LogLevel, type LogEvent } from '@obsidize/rx-console';
import { SecureLogLevel, SecureLogger } from './cordova-plugin-secure-logger';

function remapWebViewLogLevel(level: number): SecureLogLevel {
    switch (level) {
        case LogLevel.VERBOSE:  return SecureLogLevel.VERBOSE;
        case LogLevel.TRACE:    return SecureLogLevel.VERBOSE;
        case LogLevel.DEBUG:    return SecureLogLevel.DEBUG;
        case LogLevel.INFO:     return SecureLogLevel.INFO;
        case LogLevel.WARN:     return SecureLogLevel.WARN;
        case LogLevel.ERROR:    return SecureLogLevel.ERROR;
        case LogLevel.FATAL:    return SecureLogLevel.FATAL;
        default:                return SecureLogLevel.VERBOSE;
    }
}

/**
 * Converts the given rx-console event to a native event,
 * add adds it to the SecureLogger flush queue.
 */
export function sendRxConsoleEventToNative(ev: LogEvent): void {
    SecureLogger.queueEvent({
        level: remapWebViewLogLevel(ev.level),
        timestamp: ev.timestamp,
        tag: ev.tag,
        message: ev.message
    });
}