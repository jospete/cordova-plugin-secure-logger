# cordova-plugin-secure-logger

Cordova plugin to capture both webview and native log events and store them securely on disk.

**Also works out-the-box with [Capacitor](https://capacitorjs.com/)!**

## Features / Goals

- Ability to capture logs both from the webview and native side into a common **local** recording outlet
- Encrypt data before it hits the disk to protect sensitive user data
- Automatically prune oldest logs to prevent infinitely expanding log data storage

## Why make this plugin?

The most secure solution when dealing with sensitive user data is to not log anything at all.

However, when it comes to tracking down nefarious bugs that only happen in the field, the next
best thing is to capture logs in a secure sandbox - which is the aim of this plugin.

## Installation

Github:

```bash
npm i -P -E git+https://github.com/jospete/cordova-plugin-secure-logger.git#1.0.4
```

NPM / Capacitor:

```bash
npm i -P -E cordova-plugin-secure-logger@1.0.4
```

Cordova:

```bash
cordova plugin add cordova-plugin-secure-logger@1.0.4
```

## Usage

### API

Source documentation can be found [here](https://jospete.github.io/cordova-plugin-secure-logger/)

### Logging Events

You can produce logs for this plugin on both the webview and native side

#### TypeScript / JavaScript (webview)

This plugin uses [@obsidize/rx-console](https://www.npmjs.com/package/@obsidize/rx-console)
for webview log capture / filtering.

```typescript
import { Logger } from '@obsidize/rx-console';
import { enableWebviewListener } from 'cordova-plugin-secure-logger';

// Wire up the primary rx-console transport with secure logger webview proxy.
// NOTE: this only needs to be done once, on application startup.
enableWebviewListener();

class ExampleService {
    private readonly logger = new Logger('ExampleService');

    public test(): void {
        this.logger.debug(`This will be stored in an encrypted log file`);
    }

    public someOperation(): void {
        const result = JSON.stringify({error: `transfunctioner stopped combobulating`});
        this.logger.warn(tag, `Something bad happened! -> ${result}`);
    }
}

const service = new ExampleService();

// Log events from rx-console will automatically get buffered and 
// sent to the plugin on a fixed interval.
// See `SecureLogger.enable()` for more info.
service.test();
service.someOperation();
```

#### Android:

This plugin uses [Timber](https://github.com/JakeWharton/timber) for Android native log capture.
Replace `Log.xxx()` calls from `android.util.Log` with `Timer.xxx()` from `timber.log.Timber`
in other plugins, and those logs will automatically be captured by this plugin.

```kotlin
import timber.log.Timber

...

Timber.d("Logging stuff on native android for the secure logger plugin! Yay native logs!")
```

#### iOS:

This plugin uses [CocoaLumberjack](https://github.com/CocoaLumberjack/CocoaLumberjack) for iOS native log capture.
Replace `print()` / `NSLog()` calls with `DDLogXXXX()`
in other plugins, and those logs will automatically be captured by this plugin.

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
    const logCacheData = await SecureLogger.getCacheBlob();
    const bodyBlob = new Blob([logCacheData], { type: 'application/octet-stream' });
    // upload / share it somewhere
    await http.post('/log-capture', bodyBlob);
}
```

### Examples

- [Capacitor Mobile App](https://github.com/jospete/ionic-native-file-logging-example)