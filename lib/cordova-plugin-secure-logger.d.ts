export type EventFlushErrorCallback = (error: any, events: SecureLogEvent[]) => void;
/**
 * Values to indicate the level of an event.
 * mirrors levels found in android.util.Log to minimize plugin friction.
 */
export declare const enum SecureLogLevel {
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
export declare class SecureLoggerCordovaInterface {
    /**
     * When true, will attempt to re-insert the events
     * that failed to be flushed into the beginning of the cache.
     */
    recycleEventsOnFlushFailure: boolean;
    /**
     * Customizable callback to handle when event cache flush fails.
     */
    eventFlushErrorCallback: EventFlushErrorCallback | null;
    private readonly flushEventCacheProxy;
    private mEventCache;
    private mCacheFlushInterval;
    private mMaxCachedEvents;
    private mFlushIntervalDelayMs;
    private mCachingEnabled;
    constructor();
    /**
     * Maximum events allowed to be cached before
     * automatic pruning takes effect.
     * See `log()` for more info.
     *
     * default = 1000
     */
    get maxCachedEvents(): number;
    set maxCachedEvents(value: number);
    /**
     * Delay that will be used when creating the event loop interval
     * for flushing queued events.
     *
     * default = 250
     */
    get flushIntervalDelayMs(): number;
    set flushIntervalDelayMs(value: number);
    /**
     * Current state of caching / event flush interval.
     * Use `setEventCacheFlushInterval()` and `disableEventCaching()`
     * to enable and disable (respectively) caching and flush interval usage.
     */
    get cachingEnabled(): boolean;
    /**
     * Queues a new log event with the given data and level of VERBOSE
     */
    verbose(tag: string, message: string, timestamp?: number): void;
    /**
     * Queues a new log event with the given data and level of DEBUG
     */
    debug(tag: string, message: string, timestamp?: number): void;
    /**
     * Queues a new log event with the given data and level of INFO
     */
    info(tag: string, message: string, timestamp?: number): void;
    /**
     * Queues a new log event with the given data and level of WARN
     */
    warn(tag: string, message: string, timestamp?: number): void;
    /**
     * Queues a new log event with the given data and level of ERROR
     */
    error(tag: string, message: string, timestamp?: number): void;
    /**
     * Queues a new log event with the given data and level of FATAL
     */
    fatal(tag: string, message: string, timestamp?: number): void;
    /**
     * Alias of `verbose()`
     */
    trace(tag: string, message: string, timestamp?: number): void;
    /**
     * Generates a log event that will be cached for the next
     * event flush cycle, where all cached events will be handed to the plugin.
     * If this would cause the cache to become larger than `maxCachedEvents`,
     * the oldest item from the cache is removed after this new event is added.
     */
    log(level: SecureLogLevel, tag: string, message: string, timestamp?: number): void;
    /**
     * Get info about the debugging state of the app
     * (i.e. whether or not we're attached to a developer console).
     */
    getDebugState(): Promise<DebugState>;
    /**
     * Change the output state of Timber/Lumberjack native logs.
     * When enabled, native logs will show in logcat/xcode.
     */
    setDebugOutputEnabled(enabled: boolean): Promise<void>;
    /**
     * Uses native-level formatting, and automatically inserts
     * newlines between events when writing formatted content to
     * the log cache.
     */
    capture(events: SecureLogEvent[]): Promise<void>;
    /**
     * Writes the given text directly to the log cache
     * without any preprocessing.
     */
    captureText(text: string): Promise<void>;
    /**
     * Deletes all logging cache files.
     * Cannot be undone, use with caution.
     */
    clearCache(): Promise<void>;
    /**
     * Retrieves a single blob of log data which
     * contains all current log files stitched back
     * together chronologically.
     */
    getCacheBlob(): Promise<ArrayBuffer>;
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
    closeActiveStream(): Promise<void>;
    /**
     * Convenience for flushing any queued events
     * before actually closing the current stream.
     */
    flushAndCloseActiveStream(): Promise<void>;
    /**
     * Customize how this plugin should operate.
     */
    configure(options: ConfigureOptions): Promise<ConfigureResult>;
    /**
     * Completely disables event caching on this
     * interface, and clears any buffered events.
     * **NOTE**: convenience methods that use `log()` will
     * do nothing until caching is turned back on.
     */
    disableEventCaching(): void;
    /**
     * Disables the flush interval if one is set.
     * **NOTE**: this will leave the current event cache buffer in-tact.
     * To also clear the buffer, call `disableEventCaching()` instead.
     */
    clearEventCacheFlushInterval(): void;
    /**
     * Sets the interval at which cached events will be
     * flushed and sent to the native logging system.
     * If no interval value provided, the current value of
     * `flushIntervalDelayMs` will be used.
     */
    setEventCacheFlushInterval(intervalMs?: number): void;
    /**
     * Adds the given event to the event cache,
     * which will be flushed on a fixed interval.
     */
    queueEvent(ev: SecureLogEvent): void;
    /**
     * Manually flush the current set of cached events.
     * Useful for more pragmatic teardown sequencing.
     */
    flushEventCache(): Promise<void>;
    private onFlushEventCache;
    private purgeExcessEvents;
    private prependQueuedEvents;
    private onFlushCaptureFailure;
}
/**
 * Singleton reference to interact with this cordova plugin
 */
export declare const SecureLogger: SecureLoggerCordovaInterface;
