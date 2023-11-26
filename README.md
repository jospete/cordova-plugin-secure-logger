# cordova-plugin-secure-logger

Cordova plugin to capture both webview and native log events and store them securely on disk.

Pairs well with [@obsidize/rx-console](https://www.npmjs.com/package/@obsidize/rx-console)
for capturing and forwarding webview events.

## Features / Goals

- Ability to capture logs both from the webview and native side into a common **local** recording outlet
- Encrypt data before it hits the disk to protect sensitive user data
- Automatically prune oldest logs to prevent infinitely expanding log data storage

## Why make this plugin?

The most secure solution when dealing with sensitive user data is to not log anything at all.

However, when it comes to tracking down nefarious bugs that only happen in the field, the next
best thing is to capture logs in a secure sandbox - which is the aim of this plugin.

## Installation

NPM:

```bash
npm i -P -E git+https://github.com/healthrecoverysolutions/cordova-plugin-secure-logger.git#0.1.0
```

Cordova:

```bash
cordova plugin add git+https://github.com/healthrecoverysolutions/cordova-plugin-secure-logger.git#0.1.0
```

## Usage

### API

Source documentation can be found [here](https://healthrecoverysolutions.github.io/cordova-plugin-secure-logger/)

### Logging Events

You can produce logs for this plugin on both the webview and native side like so

- TypeScript / JavaScript:

```typescript
import { SecureLogger } from 'cordova-plugin-secure-logger';

const tag = `ExampleService`;

class ExampleService {

    public test(): void {
        SecureLogger.debug(tag, `This will be stored in an encrypted log file`);
    }

    public someOperation(): void {
        const result = JSON.stringify({error: `transfunctioner stopped combobulating`});
        SecureLogger.warn(tag, `Something bad happened! -> ${result}`);
    }
}

const service = new ExampleService();

// log events will automatically get buffered and 
// sent to the plugin on a fixed interval
service.test();
service.someOperation();
```

- Android:

```kotlin
import timber.log.Timber

...

Timber.d("Logging stuff on native android for the secure logger plugin! Yay native logs!")
```

- iOS:

```swift
import CocoaLumberjack

...

DDLogDebug("Logging stuff on native ios for the secure logger plugin! Yay native logs!")
```

### Gathering Logs to Report

To grab a snapshot of the current log cache:

```typescript
import { SecureLogger } from 'cordova-plugin-secure-logger';

async function uploadLogs(): Promise<void> {
    const logCacheData: ArrayBuffer = await SecureLogger.getCacheBlob();
    const bodyBlob = new Blob([logCacheData]);
    // upload / share it somewhere
    await http.post('/log-capture', bodyBlob);
}
```

### Integrations

You can use [@obsidize/rx-console](https://www.npmjs.com/package/@obsidize/rx-console) to put your webview logging on overdrive

```typescript
/* logger-bootstrap.ts */
import { getPrimaryLoggerTransport, Logger, LogEvent } from '@obsidize/rx-console';
import { SecureLogger, SecureLogLevel } from 'cordova-plugin-secure-logger';

const primaryTransport = getPrimaryLoggerTransport();
const mainLogger = new Logger('Main');

function remapLogLevel(level: number): SecureLogLevel {
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

function captureRxConsoleEvent(ev: LogEvent): void {
    SecureLogger.queueEvent({
        level: remapLogLevel(ev.level),
        timestamp: ev.timestamp,
        tag: ev.tag,
        message: ev.message
    });
}

primaryTransport
    .enableDefaultBroadcast()
    .events()
    .addListener(captureRxConsoleEvent);

mainLogger.debug(`webview-to-native logging is initialized!`);
```