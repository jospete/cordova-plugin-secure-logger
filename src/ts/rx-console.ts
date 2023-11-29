import { LogLevel, getPrimaryLoggerTransport, type LogEvent } from '@obsidize/rx-console';
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

/**
 * Activate event capture proxying for rx-console.
 * Events from rx-console package will be sent to
 * `SecureLogger` automatically after this is called.
 */
export function enableWebviewListener(): void {
    getPrimaryLoggerTransport().addListener(sendRxConsoleEventToNative);
}

/**
 * Disables event capture proxying for rx-console.
 * No events will be sent to `SecureLogger` from rx-console
 * package after this is called.
 */
export function disableWebviewListener(): void {
    getPrimaryLoggerTransport().removeListener(sendRxConsoleEventToNative);
}

/**
 * Disables both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this when you're not running in a cordova or capacitor environment
 * (e.g. vanilla webapp in a browser)
 */
export function disableWebviewToNative(): void {
    disableWebviewListener();
    SecureLogger.clearEventCacheFlushInterval();
}