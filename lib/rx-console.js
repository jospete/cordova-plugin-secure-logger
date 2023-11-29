import { LogLevel, getPrimaryLoggerTransport } from '@obsidize/rx-console';
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
export function enableWebviewListener() {
    getPrimaryLoggerTransport().addListener(sendRxConsoleEventToNative);
}
/**
 * Disables event capture proxying for rx-console.
 * No events will be sent to `SecureLogger` from rx-console
 * package after this is called.
 */
export function disableWebviewListener() {
    getPrimaryLoggerTransport().removeListener(sendRxConsoleEventToNative);
}
/**
 * Activates both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this if you need to turn the webview side of the plugin
 * back on after calling `disableWebviewToNative()`.
 */
export function enableWebviewToNative() {
    SecureLogger.setEventCacheFlushInterval();
    enableWebviewListener();
}
/**
 * Disables both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this when you're not running in a cordova or capacitor environment
 * (e.g. vanilla webapp in a browser)
 */
export function disableWebviewToNative() {
    disableWebviewListener();
    SecureLogger.clearEventCacheFlushInterval();
}
