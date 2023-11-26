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
     */
    minLevel?: SecureLogLevel;

    /**
     * If provided, will limit the size of each chunk file to the given value in bytes.
     *
     * Must be a positive integer
     */
    maxFileSizeBytes?: number;

    /**
     * If provided, will limit the aggregated total cache size that this plugin will use.
     * This is the total size of all chunk files, so if the max file size is 2MB and
     * this is set to 4MB, there will never be more than (approximately) 2 full chunk files
     * in storage at any given time.
     *
     * Must be a positive integer
     */
    maxTotalCacheSizeBytes?: number;

    /**
     * If provided, limits the max number of files in cache at any given time.
     * This will override both maxFileSizeBytes and maxTotalCacheSizeBytes if there
     * are a bunch of very small files in the cache and neither of these thresholds are met.
     *
     * Must be a positive integer
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
     * Customizable callback to handle when event cache flush fails.
     */
    public eventFlushErrorCallback: (error: any) => void = noop;

    private readonly flushEventCacheProxy = this.onFlushEventCache.bind(this);
    private readonly flushEventCacheSuccessProxy = this.onFlushEventCacheSuccess.bind(this);
    private mEventCache: SecureLogEvent[] = [];
    private mCacheFlushInterval: any = null;
    private mMaxCachedEvents: number = 1000;

    constructor() {
        // start caching events immediately so we don't
        // drop any while cordova is still standing plugins up
        this.setEventCacheFlushInterval();
    }

    /**
     * Maximum events allowed to be cached before
     * automatic pruning takes effect.
     * See `log()` for more info.
     */
    public get maxCachedEvents(): number {
        return this.mMaxCachedEvents;
    }

    public set maxCachedEvents(value: number) {
        this.mMaxCachedEvents = Math.max(1, Math.floor(value));
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
     * Stops the internal flush interval.
     * **NOTE**: convenience methods that use `log()` will 
     * do nothing until the flush interval is turned back on.
     */
    public clearEventCacheFlushInterval(): void {
        if (this.mCacheFlushInterval) {
            clearInterval(this.mCacheFlushInterval);
        }
        this.mCacheFlushInterval = null;
    }

    /**
     * Sets the interval at which cached events will be flushed
     * and sent to the native logging system.
     * Default flush interval is 1000 milliseconds.
     */
    public setEventCacheFlushInterval(intervalMs: number = 1000): void {
        this.clearEventCacheFlushInterval();
        this.mCacheFlushInterval = setInterval(
            this.flushEventCacheProxy, 
            intervalMs
        );
        // flush immediately when this is updated
        this.onFlushEventCache();
    }

    /**
     * Adds the given event to the event cache,
     * which will be flushed on a fixed interval.
     */
    public queueEvent(ev: SecureLogEvent): void {
        this.mEventCache.push(ev);
        if (this.mEventCache.length > this.maxCachedEvents) {
            this.mEventCache.shift();
        }
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
     * Queues a new log event with the given data and level of DEBUG
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

    private onFlushEventCacheSuccess(): void {
        this.mEventCache = [];
    }

    private onFlushEventCache(): void {
        if (this.mEventCache.length <= 0) {
            return;
        }
        this.capture(this.mEventCache)
            .then(this.flushEventCacheSuccessProxy)
            .catch(this.eventFlushErrorCallback);
    }
}

/**
 * Singleton reference to interact with this cordova plugin
 */
export const SecureLogger = new SecureLoggerCordovaInterface();