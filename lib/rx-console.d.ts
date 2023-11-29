import { type LogEvent, LoggerTransport } from '@obsidize/rx-console';
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
export declare function enableWebviewListener(transport?: LoggerTransport): void;
/**
 * Disables event capture proxying for rx-console.
 * No events will be sent to `SecureLogger` from rx-console
 * package after this is called.
 */
export declare function disableWebviewListener(transport?: LoggerTransport): void;
/**
 * Activates both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this if you need to turn the webview side of the plugin
 * back on after calling `disableWebviewToNative()`.
 */
export declare function enableWebviewToNative(transport?: LoggerTransport): void;
/**
 * Disables both rx-console event capture AND the
 * automated event cache flush interval on the plugin.
 * Call this when you're not running in a cordova or capacitor environment
 * (e.g. vanilla webapp in a browser)
 */
export declare function disableWebviewToNative(transport?: LoggerTransport): void;
