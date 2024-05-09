import { LogEvent, LogLevel, LoggerTransport, getPrimaryLoggerTransport, stringifyAndJoin } from '@obsidize/rx-console';
import { SecureLogLevel, SecureLogger } from './cordova-plugin-secure-logger';

const READY_EVENT = 'deviceready';
const PAUSE_EVENT = 'pause';

let didAddPauseFlushHook = false;
let didAddReadyFlushIntervalHook = false;

function noop() {
}

function flushAndClosePauseHook() {
    SecureLogger.flushAndCloseActiveStream().catch(noop);
}

function addFlushAndClosePauseHook(): void {
    if (!didAddPauseFlushHook) {
        document.addEventListener(PAUSE_EVENT, flushAndClosePauseHook);
        didAddPauseFlushHook = true;
    }
}

function removeFlushAndClosePauseHook(): void {
    if (didAddPauseFlushHook) {
        document.removeEventListener(PAUSE_EVENT, flushAndClosePauseHook);
        didAddPauseFlushHook = false;
    }
}

function flushIntervalReadyHook() {
    SecureLogger.setEventCacheFlushInterval();
}

function addFlushIntervalReadyHook(): void {
    if (!didAddReadyFlushIntervalHook) {
        document.addEventListener(READY_EVENT, flushIntervalReadyHook);
        didAddReadyFlushIntervalHook = true;
    }
}

function removeFlushIntervalReadyHook(): void {
    if (didAddReadyFlushIntervalHook) {
        document.removeEventListener(READY_EVENT, flushIntervalReadyHook);
        didAddReadyFlushIntervalHook = false;
    }
}

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

    // need to check this in case a pre-6.1.6 version of rx-console is installed
    if (typeof (ev.getMessageWithParams) === 'function') {
        return ev.getMessageWithParams();
    }

    return ev.message + stringifyAndJoin(ev.params);
}

/**
 * Extra configuration options for enabling webview logs.
 */
export interface WebViewEventListenerEnableOptions {
    flushOnPause?: boolean;
    startFlushIntervalOnReady?: boolean;
}

/**
 * Defaults for webview logging enablement.
 */
export const defaultOptions: WebViewEventListenerEnableOptions = {
    flushOnPause: true,
    startFlushIntervalOnReady: true
};

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
    transport: LoggerTransport = getPrimaryLoggerTransport(),
    options: WebViewEventListenerEnableOptions = defaultOptions
): void {
    transport.addListener(sendRxConsoleEventToNative);
    if (options?.flushOnPause) addFlushAndClosePauseHook();
    if (options?.startFlushIntervalOnReady) addFlushIntervalReadyHook();
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
    removeFlushAndClosePauseHook();
    removeFlushIntervalReadyHook();
}
