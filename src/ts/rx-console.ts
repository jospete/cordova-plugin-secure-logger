import { LogEvent, LogLevel, LoggerTransport, getPrimaryLoggerTransport, stringifyAndJoin } from '@obsidize/rx-console';
import { SecureLogLevel, SecureLogger } from './cordova-plugin-secure-logger';

function remapWebviewLogLevel(level: number): SecureLogLevel {
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

function getFullWebviewEventMessage(ev: LogEvent): string {

    // need to check this in case a pre-6.1.6 version is installed
    if (typeof (ev.getMessageWithParams) === 'function') {
        return ev.getMessageWithParams();
    }

    return ev.message + stringifyAndJoin(ev.params);
}

/**
 * Converts the given rx-console event to a native event,
 * add adds it to the SecureLogger flush queue.
 */
export function sendRxConsoleEventToNative(ev: LogEvent): void {
    SecureLogger.queueEvent({
        timestamp: ev.timestamp,
        tag: ev.tag,
        level: remapWebviewLogLevel(ev.level),
        message: getFullWebviewEventMessage(ev)
    });
}

/**
 * Activate event capture proxying for rx-console.
 * Events from rx-console package will be sent to
 * `SecureLogger` automatically after this is called.
 * 
 * NOTE: calling this rather than `enableWebviewToNative()`
 * is sufficient for most cases, as the event cache flush
 * interval is enabled by default when `SecureLogger`
 * is initialized.
 */
export function enableWebviewListener(
    transport: LoggerTransport = getPrimaryLoggerTransport()
): void {
    transport.addListener(sendRxConsoleEventToNative);
}

/**
 * Disables event capture proxying for rx-console.
 * No events will be sent to `SecureLogger` from rx-console
 * package after this is called.
 */
export function disableWebviewListener(
    transport: LoggerTransport = getPrimaryLoggerTransport()
): void {
    transport.removeListener(sendRxConsoleEventToNative);
}

/**
 * Activates both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this if you need to turn the webview side of the plugin
 * back on after calling `disableWebviewToNative()`.
 */
export function enableWebviewToNative(transport?: LoggerTransport): void {
    SecureLogger.setEventCacheFlushInterval();
    enableWebviewListener(transport);
}

/**
 * Disables both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this when you're not running in a cordova or capacitor environment
 * (e.g. vanilla webapp in a browser)
 */
export function disableWebviewToNative(transport?: LoggerTransport): void {
    disableWebviewListener(transport);
    SecureLogger.disableEventCaching();
}