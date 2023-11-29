import { type LogEvent } from '@obsidize/rx-console';
/**
 * Converts the given rx-console event to a native event,
 * add adds it to the SecureLogger flush queue.
 */
export declare function sendRxConsoleEventToNative(ev: LogEvent): void;
