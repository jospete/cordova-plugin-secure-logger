////////////////////////////////////////////////////////////////
// Generic Cordova Utilities
////////////////////////////////////////////////////////////////
function noop() {
    return;
}
function cordovaExec(plugin, method, successCallback = noop, errorCallback = noop, args = []) {
    if (window.cordova) {
        window.cordova.exec(successCallback, errorCallback, plugin, method, args);
    }
    else {
        console.warn(`${plugin}.${method}(...) :: cordova not available`);
        errorCallback && errorCallback(`cordova_not_available`);
    }
}
function cordovaExecPromise(plugin, method, args) {
    return new Promise((resolve, reject) => {
        cordovaExec(plugin, method, resolve, reject, args);
    });
}
////////////////////////////////////////////////////////////////
// Plugin Interface
////////////////////////////////////////////////////////////////
const PLUGIN_NAME = 'SecureLoggerPlugin';
function invoke(method, ...args) {
    return cordovaExecPromise(PLUGIN_NAME, method, args);
}
function normalizeConfigureResult(value) {
    if (!value) {
        return { success: false, error: `invalid configure response: ${value}` };
    }
    if (!Array.isArray(value.errors)) {
        value.errors = [];
    }
    if (typeof value.success !== 'boolean') {
        value.success = !value.error && value.errors.length <= 0;
    }
    return value;
}
function unwrapConfigureResult(value) {
    return (value && value.success) ? Promise.resolve(value) : Promise.reject(value);
}
export class SecureLoggerCordovaInterface {
    constructor() {
        /**
         * Customizable callback to handle when event cache flush fails.
         */
        this.eventFlushErrorCallback = null;
        this.flushEventCacheProxy = this.onFlushEventCache.bind(this);
        this.mEventCache = [];
        this.mCacheFlushInterval = null;
        this.mMaxCachedEvents = 1000;
        this.mCachingEnabled = false;
    }
    /**
     * Maximum events allowed to be cached before
     * automatic pruning takes effect.
     * See `log()` for more info.
     */
    get maxCachedEvents() {
        return this.mMaxCachedEvents;
    }
    set maxCachedEvents(value) {
        this.mMaxCachedEvents = Math.max(1, Math.floor(value));
    }
    /**
     * Current state of caching / event flush interval.
     * Use `setEventCacheFlushInterval()` and `disableEventCaching()`
     * to enable and disable (respectively) caching and flush interval usage.
     */
    get cachingEnabled() {
        return this.mCachingEnabled;
    }
    /**
     * Queues a new log event with the given data and level of VERBOSE
     */
    verbose(tag, message, timestamp) {
        this.log(2 /* SecureLogLevel.VERBOSE */, tag, message, timestamp);
    }
    /**
     * Queues a new log event with the given data and level of DEBUG
     */
    debug(tag, message, timestamp) {
        this.log(3 /* SecureLogLevel.DEBUG */, tag, message, timestamp);
    }
    /**
     * Queues a new log event with the given data and level of INFO
     */
    info(tag, message, timestamp) {
        this.log(4 /* SecureLogLevel.INFO */, tag, message, timestamp);
    }
    /**
     * Queues a new log event with the given data and level of WARN
     */
    warn(tag, message, timestamp) {
        this.log(5 /* SecureLogLevel.WARN */, tag, message, timestamp);
    }
    /**
     * Queues a new log event with the given data and level of ERROR
     */
    error(tag, message, timestamp) {
        this.log(6 /* SecureLogLevel.ERROR */, tag, message, timestamp);
    }
    /**
     * Queues a new log event with the given data and level of FATAL
     */
    fatal(tag, message, timestamp) {
        this.log(7 /* SecureLogLevel.FATAL */, tag, message, timestamp);
    }
    /**
     * Alias of `verbose()`
     */
    trace(tag, message, timestamp) {
        this.verbose(tag, message, timestamp);
    }
    /**
     * Generates a log event that will be cached for the next
     * event flush cycle, where all cached events will be handed to the plugin.
     * If this would cause the cache to become larger than `maxCachedEvents`,
     * the oldest item from the cache is removed after this new event is added.
     */
    log(level, tag, message, timestamp = Date.now()) {
        this.queueEvent({ level, tag, message, timestamp });
    }
    /**
     * Get info about the debugging state of the app
     * (i.e. whether or not we're attached to a developer console).
     */
    getDebugState() {
        return invoke('getDebugState');
    }
    /**
     * Change the output state of Timber/Lumberjack native logs.
     * When enabled, native logs will show in logcat/xcode.
     */
    setDebugOutputEnabled(enabled) {
        return invoke('setDebugOutputEnabled', enabled);
    }
    /**
     * Uses native-level formatting, and automatically inserts
     * newlines between events when writing formatted content to
     * the log cache.
     */
    capture(events) {
        return invoke('capture', events);
    }
    /**
     * Writes the given text directly to the log cache
     * without any preprocessing.
     */
    captureText(text) {
        return invoke('captureText', text);
    }
    /**
     * Deletes all logging cache files.
     * Cannot be undone, use with caution.
     */
    clearCache() {
        return invoke('clearCache');
    }
    /**
     * Retrieves a single blob of log data which
     * contains all current log files stitched back
     * together chronologically.
     */
    getCacheBlob() {
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
    closeActiveStream() {
        return invoke('closeActiveStream');
    }
    /**
     * Convenience for flushing any queued events
     * before actually closing the current stream.
     */
    flushAndCloseActiveStream() {
        const close = () => this.closeActiveStream();
        return this.flushEventCache().then(close, close);
    }
    /**
     * Customize how this plugin should operate.
     */
    configure(options) {
        return invoke('configure', options)
            .then(normalizeConfigureResult)
            .then(unwrapConfigureResult);
    }
    /**
     * Completely disables event caching on this
     * interface, and clears any buffered events.
     * **NOTE**: convenience methods that use `log()` will
     * do nothing until caching is turned back on.
     */
    disableEventCaching() {
        this.clearEventCacheFlushInterval();
        this.mEventCache = [];
    }
    /**
     * Disables the flush interval if one is set.
     * **NOTE**: this will leave the current event cache buffer in-tact.
     * To also clear the buffer, call `disableEventCaching()` instead.
     */
    clearEventCacheFlushInterval() {
        if (this.mCachingEnabled) {
            clearInterval(this.mCacheFlushInterval);
            this.mCacheFlushInterval = null;
            this.mCachingEnabled = false;
        }
    }
    /**
     * Sets the interval at which cached events will be flushed
     * and sent to the native logging system.
     * Default flush interval is 1000 milliseconds.
     */
    setEventCacheFlushInterval(intervalMs = 1000) {
        this.clearEventCacheFlushInterval();
        this.mCacheFlushInterval = setInterval(this.flushEventCacheProxy, intervalMs);
        this.mCachingEnabled = true;
        // flush immediately when this is updated
        this.onFlushEventCache();
    }
    /**
     * Adds the given event to the event cache,
     * which will be flushed on a fixed interval.
     */
    queueEvent(ev) {
        this.mEventCache.push(ev);
        if (this.mEventCache.length > this.maxCachedEvents) {
            this.mEventCache.shift();
        }
    }
    /**
     * Manually flush the current set of cached events.
     * Useful for more pragmatic teardown sequencing.
     */
    flushEventCache() {
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
        return this.capture(capturedEvents).catch((err) => {
            var _a;
            if (typeof this.eventFlushErrorCallback === 'function') {
                this.eventFlushErrorCallback(err, capturedEvents);
            }
            else {
                this.error(PLUGIN_NAME, `failed to capture ${(_a = capturedEvents === null || capturedEvents === void 0 ? void 0 : capturedEvents.length) !== null && _a !== void 0 ? _a : -1} events!`);
            }
        });
    }
    onFlushEventCache() {
        this.flushEventCache().catch(noop);
    }
}
/**
 * Singleton reference to interact with this cordova plugin
 */
export const SecureLogger = new SecureLoggerCordovaInterface();
