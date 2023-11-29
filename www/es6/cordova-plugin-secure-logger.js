import { LogLevel } from '@obsidize/rx-console';
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
function remapWebViewLogLevel(level) {
    switch (level) {
        case LogLevel.VERBOSE: return 2 /* SecureLogLevel.VERBOSE */;
        case LogLevel.TRACE: return 2 /* SecureLogLevel.VERBOSE */;
        case LogLevel.DEBUG: return 3 /* SecureLogLevel.DEBUG */;
        case LogLevel.INFO: return 4 /* SecureLogLevel.INFO */;
        case LogLevel.WARN: return 5 /* SecureLogLevel.WARN */;
        case LogLevel.ERROR: return 6 /* SecureLogLevel.ERROR */;
        case LogLevel.FATAL: return 7 /* SecureLogLevel.FATAL */;
        default: return 2 /* SecureLogLevel.VERBOSE */;
    }
}
export class SecureLoggerCordovaInterface {
    constructor() {
        /**
         * Function ref that can be passed directly to
         * `LoggerTransport.events().addListener(...)`
         */
        this.webviewEventListenerProxy = this.queueWebViewEvent.bind(this);
        /**
         * Customizable callback to handle when event cache flush fails.
         */
        this.eventFlushErrorCallback = noop;
        this.flushEventCacheProxy = this.onFlushEventCache.bind(this);
        this.flushEventCacheSuccessProxy = this.onFlushEventCacheSuccess.bind(this);
        this.mEventCache = [];
        this.mCacheFlushInterval = null;
        this.mMaxCachedEvents = 1000;
        // start caching events immediately so we don't
        // drop any while cordova is still standing plugins up
        this.setEventCacheFlushInterval();
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
     * Stops the internal flush interval.
     * **NOTE**: convenience methods that use `log()` will
     * do nothing until the flush interval is turned back on.
     */
    clearEventCacheFlushInterval() {
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
    setEventCacheFlushInterval(intervalMs = 1000) {
        this.clearEventCacheFlushInterval();
        this.mCacheFlushInterval = setInterval(this.flushEventCacheProxy, intervalMs);
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
     * Converts the given rx-console event to a native event,
     * add adds it to the flush queue.
     */
    queueWebViewEvent(ev) {
        this.queueEvent({
            level: remapWebViewLogLevel(ev.level),
            timestamp: ev.timestamp,
            tag: ev.tag,
            message: ev.message
        });
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
     * Queues a new log event with the given data and level of DEBUG
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
    onFlushEventCacheSuccess() {
        this.mEventCache = [];
    }
    onFlushEventCache() {
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
