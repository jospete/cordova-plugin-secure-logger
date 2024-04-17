import { LogLevel, getPrimaryLoggerTransport, stringifyAndJoin } from '@obsidize/rx-console';
import { SecureLogger } from './cordova-plugin-secure-logger';
const PAUSE_EVENT = 'pause';
let didAddFlushHook = false;
function flushAndClose() {
    SecureLogger.flushAndCloseActiveStream().catch(() => { });
}
function addFlushAndClosePauseHook() {
    if (!didAddFlushHook) {
        document.addEventListener(PAUSE_EVENT, flushAndClose);
        didAddFlushHook = true;
    }
}
function removeFlushAndClosePauseHook() {
    if (didAddFlushHook) {
        document.removeEventListener(PAUSE_EVENT, flushAndClose);
        didAddFlushHook = false;
    }
}
function remapWebviewLogLevel(level) {
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
function getFullWebviewEventMessage(ev) {
    // need to check this in case a pre-6.1.6 version of rx-console is installed
    if (typeof (ev.getMessageWithParams) === 'function') {
        return ev.getMessageWithParams();
    }
    return ev.message + stringifyAndJoin(ev.params);
}
/**
 * Defaults for webview logging enablement.
 */
export const defaultOptions = {
    flushOnPause: true
};
/**
 * Converts the given rx-console event to a native event,
 * add adds it to the SecureLogger flush queue.
 */
export function sendRxConsoleEventToNative(ev) {
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
export function enableWebviewListener(transport = getPrimaryLoggerTransport(), options = defaultOptions) {
    transport.addListener(sendRxConsoleEventToNative);
    if (options === null || options === void 0 ? void 0 : options.flushOnPause)
        addFlushAndClosePauseHook();
}
/**
 * Disables event capture proxying for rx-console.
 * No events will be sent to `SecureLogger` from rx-console
 * package after this is called.
 */
export function disableWebviewListener(transport = getPrimaryLoggerTransport()) {
    transport.removeListener(sendRxConsoleEventToNative);
    removeFlushAndClosePauseHook();
}
/**
 * Activates both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this if you need to turn the webview side of the plugin
 * back on after calling `disableWebviewToNative()`.
 */
export function enableWebviewToNative(transport) {
    SecureLogger.setEventCacheFlushInterval();
    enableWebviewListener(transport);
}
/**
 * Disables both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this when you're not running in a cordova or capacitor environment
 * (e.g. vanilla webapp in a browser)
 */
export function disableWebviewToNative(transport) {
    disableWebviewListener(transport);
    SecureLogger.disableEventCaching();
}
