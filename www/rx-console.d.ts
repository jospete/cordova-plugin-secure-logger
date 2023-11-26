import { LogEvent } from '@obsidize/rx-console';
import { SecureLogLevel } from './cordova-plugin-secure-logger';
export declare function remapLogLevel(level: number): SecureLogLevel;
export declare function sendRxConsoleEventToNative(ev: LogEvent): void;
