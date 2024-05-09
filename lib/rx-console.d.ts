import { LogEvent, LoggerTransport } from '@obsidize/rx-console';
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
export declare const defaultOptions: WebViewEventListenerEnableOptions;
/**
 * Converts the given rx-console event to a native event,
 * add adds it to the SecureLogger flush queue.
 */
export declare function sendRxConsoleEventToNative(ev: LogEvent): void;
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
export declare function enableWebviewListener(transport?: LoggerTransport, options?: WebViewEventListenerEnableOptions): void;
/**
 * Disables event capture proxying for rx-console.
 * No events will be sent to `SecureLogger` from rx-console
 * package after this is called.
 */
export declare function disableWebviewListener(transport?: LoggerTransport): void;
