import { LogLevel, getPrimaryLoggerTransport, stringifyAndJoin } from '@obsidize/rx-console';
import { SecureLogger } from './cordova-plugin-secure-logger';
const READY_EVENT = 'deviceready';
const PAUSE_EVENT = 'pause';
let webviewListenerEnabled = false;
let didAddPauseFlushHook = false;
let didAddReadyFlushIntervalHook = false;
let didReadyEventFire = false;
// begin watching for ready event immediately to maintain correct state
document.addEventListener(READY_EVENT, () => {
    didReadyEventFire = true;
});
function noop() {
}
function flushAndClosePauseHook() {
    SecureLogger.flushAndCloseActiveStream().catch(noop);
}
function addFlushAndClosePauseHook() {
    if (!didAddPauseFlushHook) {
        document.addEventListener(PAUSE_EVENT, flushAndClosePauseHook);
        didAddPauseFlushHook = true;
    }
}
function removeFlushAndClosePauseHook() {
    if (didAddPauseFlushHook) {
        document.removeEventListener(PAUSE_EVENT, flushAndClosePauseHook);
        didAddPauseFlushHook = false;
    }
}
function flushIntervalReadyHook() {
    SecureLogger.setEventCacheFlushInterval();
}
function addFlushIntervalReadyHook() {
    if (didReadyEventFire) {
        // if ready event already fired, call hook immediately
        flushIntervalReadyHook();
    }
    else if (!didAddReadyFlushIntervalHook) {
        document.addEventListener(READY_EVENT, flushIntervalReadyHook);
        didAddReadyFlushIntervalHook = true;
    }
}
function removeFlushIntervalReadyHook() {
    if (didAddReadyFlushIntervalHook) {
        document.removeEventListener(READY_EVENT, flushIntervalReadyHook);
        didAddReadyFlushIntervalHook = false;
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
    flushOnPause: true,
    startFlushIntervalOnReady: true
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
    if (!webviewListenerEnabled) {
        transport.addListener(sendRxConsoleEventToNative);
        if (options === null || options === void 0 ? void 0 : options.startFlushIntervalOnReady)
            addFlushIntervalReadyHook();
        if (options === null || options === void 0 ? void 0 : options.flushOnPause)
            addFlushAndClosePauseHook();
        webviewListenerEnabled = true;
    }
}
/**
 * Disables event capture proxying for rx-console.
 * No events will be sent to `SecureLogger` from rx-console
 * package after this is called.
 */
export function disableWebviewListener(transport = getPrimaryLoggerTransport()) {
    if (webviewListenerEnabled) {
        // unwind hooks in the opposite order they were added
        removeFlushAndClosePauseHook();
        removeFlushIntervalReadyHook();
        transport.removeListener(sendRxConsoleEventToNative);
        SecureLogger.clearEventCacheFlushInterval();
        webviewListenerEnabled = false;
    }
}
