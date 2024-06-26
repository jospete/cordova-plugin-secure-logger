////////////////////////////////////////////////////////////////
// Generic Cordova Utilities
////////////////////////////////////////////////////////////////

type SuccessCallback<TValue> = (value: TValue) => void;
type ErrorCallback = (error: any) => void;

function noop() {
    return;
}

function cordovaExec<T>(
    plugin: string,
	method: string,
	successCallback: SuccessCallback<T> = noop,
	errorCallback: ErrorCallback = noop,
	args: any[] = [],
): void {
    if (window.cordova) {
        window.cordova.exec(successCallback, errorCallback, plugin, method, args);

    } else {
        console.warn(`${plugin}.${method}(...) :: cordova not available`);
        errorCallback && errorCallback(`cordova_not_available`);
    }
}

function cordovaExecPromise<T>(plugin: string, method: string, args?: any[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        cordovaExec<T>(plugin, method, resolve, reject, args);
    });
}

////////////////////////////////////////////////////////////////
// Plugin Interface
////////////////////////////////////////////////////////////////

const PLUGIN_NAME = 'SecureLoggerPlugin';

function invoke<T>(method: string, ...args: any[]): Promise<T> {
    return cordovaExecPromise<T>(PLUGIN_NAME, method, args);
}

export type EventFlushErrorCallback = (error: any, events: SecureLogEvent[]) => void;

/**
 * Values to indicate the level of an event.
 * mirrors levels found in android.util.Log to minimize plugin friction.
 */
export const enum SecureLogLevel {
    VERBOSE = 2,
    DEBUG = 3,
    INFO = 4,
    WARN = 5,
    ERROR = 6,
    FATAL = 7
}

export interface SecureLogEvent {

    /**
     * EPOCH-based timestamp, e.g. Date.now()
     */
    timestamp: number;

    /**
     * Priority level of this event
     */
    level: SecureLogLevel;

    /**
     * Scope indicating what module the event came from
     */
    tag: string;

    /**
     * Description of what happened when the event occurred
     */
    message: string;
}

export interface ConfigureOptions {

    /**
     * If provided, will filter all logs on both webview and native
     * that are below the given level from entering the file cache.
     * For example, if this is set to DEBUG, all TRACE logs will be filtered out.
     * 
     * default: `SecureLogLevel.VERBOSE`
     */
    minLevel?: SecureLogLevel;

    /**
     * If provided, will limit the size of each chunk file to the given value in bytes.
     *
     * must be a positive integer
     * 
     * min: 1000 (1KB)
     * max: 4000000 (4MB)
     * default: 2000000 (2MB)
     */
    maxFileSizeBytes?: number;

    /**
     * If provided, will limit the aggregated total cache size that this plugin will use.
     * This is the total size of all chunk files, so if the max file size is 2MB and
     * this is set to 4MB, there will never be more than (approximately) 2 full chunk files
     * in storage at any given time.
     *
     * must be a positive integer
     * 
     * min: 1000 (1KB)
     * max: 64000000 (64MB)
     * default: 8000000 (8MB)
     */
    maxTotalCacheSizeBytes?: number;

    /**
     * If provided, limits the max number of files in cache at any given time.
     * This will override both maxFileSizeBytes and maxTotalCacheSizeBytes if there
     * are a bunch of very small files in the cache and neither of these thresholds are met.
     *
     * must be a positive integer
     * 
     * min: 1
     * max: 100
     * default: 40
     */
    maxFileCount?: number;
}

/**
 * Specific info on why setting a certain option failed.
 */
export interface ConfigureOptionError {

    /**
     * The key from `ConfigureOptions` that caused the error
     */
    option: string;

    /**
     * Failure reason (e.g. negative number when indicating size, or invalid log level)
     */
    error: string;
}

/**
 * Plugin response for configure()
 * If success is false, check the `errors` property for which fields had issues
 */
export interface ConfigureResult {
    success: boolean;
    error?: string;
    errors?: ConfigureOptionError[];
}

/**
 * Flags/values regarding current debug state of the app
 */
export interface DebugState {

    /**
     * Flag indicating whether we are attached to a developer console of some sort.
     */
    debuggerAttached: boolean;

    /**
     * Flag indicating whether Timber/Lumberjack are currently 
     * configured to post events to the attached debugger console.
     * 
     * When enabled, native logs will show in logcat/xcode.
     * 
     * Can be changed by calling `setDebugOutputEnabled()` on this plugin.
     */
    debugOutputEnabled: boolean;
}

function normalizeConfigureResult(value: Partial<ConfigureResult>): ConfigureResult {

    if (!value) {
        return {success: false, error: `invalid configure response: ${value}`};
    }

    if (!Array.isArray(value.errors)) {
        value.errors = [];
    }

    if (typeof value.success !== 'boolean') {
        value.success = !value.error && value.errors.length <= 0;
    }

    return value as ConfigureResult;
}

function unwrapConfigureResult(value: ConfigureResult): Promise<ConfigureResult> {
    return (value && value.success) ? Promise.resolve(value) : Promise.reject(value);
}

export class SecureLoggerCordovaInterface {

    /**
     * When true, will attempt to re-insert the events
     * that failed to be flushed into the beginning of the cache.
     */
    public recycleEventsOnFlushFailure: boolean = true;

    /**
     * Customizable callback to handle when event cache flush fails.
     */
    public eventFlushErrorCallback: EventFlushErrorCallback | null = null;

    private readonly flushEventCacheProxy: () => void = this.onFlushEventCache.bind(this);
    private mEventCache: SecureLogEvent[] = [];
    private mCacheFlushInterval: any = null;
    private mMaxCachedEvents: number = 1000;
    private mFlushIntervalDelayMs: number = 250;
    private mCachingEnabled: boolean = false;

    constructor() {
    }

    /**
     * Maximum events allowed to be cached before
     * automatic pruning takes effect.
     * See `log()` for more info.
     * 
     * default = 1000
     */
    public get maxCachedEvents(): number {
        return this.mMaxCachedEvents;
    }

    public set maxCachedEvents(value: number) {
        if (typeof value === 'number') {
            this.mMaxCachedEvents = Math.max(1, Math.floor(value));
        }
    }

    /**
     * Delay that will be used when creating the event loop interval
     * for flushing queued events.
     * 
     * default = 250
     */
    public get flushIntervalDelayMs(): number {
        return this.mFlushIntervalDelayMs;
    }

    public set flushIntervalDelayMs(value: number) {
        if (typeof value === 'number') {
            this.mFlushIntervalDelayMs = Math.max(0, Math.floor(value));
        }
    }

    /**
     * Current state of caching / event flush interval.
     * Use `setEventCacheFlushInterval()` and `disableEventCaching()`
     * to enable and disable (respectively) caching and flush interval usage.
     */
    public get cachingEnabled(): boolean {
        return this.mCachingEnabled;
    }

    /**
     * Queues a new log event with the given data and level of VERBOSE
     */
    public verbose(tag: string, message: string, timestamp?: number): void {
        this.log(SecureLogLevel.VERBOSE, tag, message, timestamp);
    }

    /**
     * Queues a new log event with the given data and level of DEBUG
     */
    public debug(tag: string, message: string, timestamp?: number): void {
        this.log(SecureLogLevel.DEBUG, tag, message, timestamp);
    }

    /**
     * Queues a new log event with the given data and level of INFO
     */
    public info(tag: string, message: string, timestamp?: number): void {
        this.log(SecureLogLevel.INFO, tag, message, timestamp);
    }

    /**
     * Queues a new log event with the given data and level of WARN
     */
    public warn(tag: string, message: string, timestamp?: number): void {
        this.log(SecureLogLevel.WARN, tag, message, timestamp);
    }

    /**
     * Queues a new log event with the given data and level of ERROR
     */
    public error(tag: string, message: string, timestamp?: number): void {
        this.log(SecureLogLevel.ERROR, tag, message, timestamp);
    }

    /**
     * Queues a new log event with the given data and level of FATAL
     */
    public fatal(tag: string, message: string, timestamp?: number): void {
        this.log(SecureLogLevel.FATAL, tag, message, timestamp);
    }

    /**
     * Alias of `verbose()`
     */
    public trace(tag: string, message: string, timestamp?: number): void {
        this.verbose(tag, message, timestamp);
    }

    /**
     * Generates a log event that will be cached for the next
     * event flush cycle, where all cached events will be handed to the plugin.
     * If this would cause the cache to become larger than `maxCachedEvents`,
     * the oldest item from the cache is removed after this new event is added.
     */
    public log(level: SecureLogLevel, tag: string, message: string, timestamp: number = Date.now()): void {
        this.queueEvent({level, tag, message, timestamp});
    }

    /**
     * Get info about the debugging state of the app
     * (i.e. whether or not we're attached to a developer console).
     */
    public getDebugState(): Promise<DebugState> {
        return invoke<DebugState>('getDebugState');
    }

    /**
     * Change the output state of Timber/Lumberjack native logs.
     * When enabled, native logs will show in logcat/xcode.
     */
    public setDebugOutputEnabled(enabled: boolean): Promise<void> {
        return invoke('setDebugOutputEnabled', enabled);
    }

    /**
     * Uses native-level formatting, and automatically inserts
     * newlines between events when writing formatted content to
     * the log cache.
     */
    public capture(events: SecureLogEvent[]): Promise<void> {
        return invoke('capture', events);
    }

    /**
     * Writes the given text directly to the log cache
     * without any preprocessing.
     */
    public captureText(text: string): Promise<void> {
        return invoke('captureText', text);
    }

    /**
     * Deletes all logging cache files.
     * Cannot be undone, use with caution.
     */
    public clearCache(): Promise<void> {
        return invoke('clearCache');
    }

    /**
     * Retrieves a single blob of log data which
     * contains all current log files stitched back
     * together chronologically.
     */
    public getCacheBlob(): Promise<ArrayBuffer> {
        return invoke('getCacheBlob');
    }

    /**
     * Manually close the current active file stream
     * which logs are being written to.
     *
     * Call this if your app is about to close and
     * you want to prevent potential log data loss
     *
     * (e.g. if the app is about to be killed non-gracefully and 
     * native on-destroy callbacks will not get called)
     */
    public closeActiveStream(): Promise<void> {
        return invoke('closeActiveStream');
    }

    /**
     * Convenience for flushing any queued events
     * before actually closing the current stream.
     */
    public flushAndCloseActiveStream(): Promise<void> {
        const close = () => this.closeActiveStream();
        return this.flushEventCache().then(close, close);
    }

    /**
     * Customize how this plugin should operate.
     */
    public configure(options: ConfigureOptions): Promise<ConfigureResult> {
        return invoke<Partial<ConfigureResult>>('configure', options)
            .then(normalizeConfigureResult)
            .then(unwrapConfigureResult);
    }

    /**
     * Completely disables event caching on this 
     * interface, and clears any buffered events.
     * **NOTE**: convenience methods that use `log()` will 
     * do nothing until caching is turned back on.
     */
    public disableEventCaching(): void {
        this.clearEventCacheFlushInterval();
        this.mEventCache = [];
    }

    /**
     * Disables the flush interval if one is set.
     * **NOTE**: this will leave the current event cache buffer in-tact.
     * To also clear the buffer, call `disableEventCaching()` instead.
     */
    public clearEventCacheFlushInterval(): void {
        if (this.mCachingEnabled) {
            clearInterval(this.mCacheFlushInterval);
            this.mCacheFlushInterval = null;
            this.mCachingEnabled = false;
        }
    }

    /**
     * Sets the interval at which cached events will be 
     * flushed and sent to the native logging system.
     * If no interval value provided, the current value of
     * `flushIntervalDelayMs` will be used.
     */
    public setEventCacheFlushInterval(intervalMs?: number): void {
        if (typeof intervalMs === 'number') {
            this.flushIntervalDelayMs = intervalMs;
        }

        this.clearEventCacheFlushInterval();
        this.mCacheFlushInterval = setInterval(
            this.flushEventCacheProxy, 
            this.flushIntervalDelayMs
        );
        
        this.mCachingEnabled = true;
        // flush immediately when this is updated
        this.onFlushEventCache();
    }

    /**
     * Adds the given event to the event cache,
     * which will be flushed on a fixed interval.
     */
    public queueEvent(ev: SecureLogEvent): void {
        this.mEventCache.push(ev);
        this.purgeExcessEvents();
    }

    /**
     * Manually flush the current set of cached events.
     * Useful for more pragmatic teardown sequencing.
     */
    public flushEventCache(): Promise<void> {
        if (this.mEventCache.length <= 0) {
            return Promise.resolve();
        }
        
        // Isolate current cache from any asynchronous incoming logs.
        // Avoids scenarios where logs would get duplicated due to
        // `capture()` delays - i.e., cache array would not get cleared until `capture()`
        // resolves, at which point more logs may have gotten stacked onto
        // the cache array.
        const capturedEvents = this.mEventCache;
        this.mEventCache = [];

        return this.capture(capturedEvents).catch((err: any) => {
            this.onFlushCaptureFailure(err, capturedEvents);
        });
    }

    private onFlushEventCache(): void {
        this.flushEventCache().catch(noop);
    }

    private purgeExcessEvents(): void {
        while (this.mEventCache.length > this.maxCachedEvents) {
            this.mEventCache.shift(); // remove in order of older -> newer
        }
    }

    private prependQueuedEvents(events: SecureLogEvent[]): void {
        this.mEventCache.unshift(...events);
        this.purgeExcessEvents();
    }

    private onFlushCaptureFailure(error: any, events: SecureLogEvent[]): void {
        if (typeof this.eventFlushErrorCallback === 'function') {
            this.eventFlushErrorCallback(error, events);
        }

        if (this.recycleEventsOnFlushFailure) {
            this.prependQueuedEvents(events);
        }

        this.error(PLUGIN_NAME, `failed to capture ${events?.length ?? -1} events! (error was: ${error})`);
    }
}

/**
 * Singleton reference to interact with this cordova plugin
 */
export const SecureLogger = new SecureLoggerCordovaInterface();
