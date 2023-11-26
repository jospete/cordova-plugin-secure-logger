import { LogLevel, LogEvent } from '@obsidize/rx-console';
import { SecureLogger, SecureLogLevel } from './cordova-plugin-secure-logger';

export function remapLogLevel(level: number): SecureLogLevel {
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

export function sendRxConsoleEventToNative(ev: LogEvent): void {
    SecureLogger.queueEvent({
        level: remapLogLevel(ev.level),
        timestamp: ev.timestamp,
        tag: ev.tag,
        message: ev.message
    });
}