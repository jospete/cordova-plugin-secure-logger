"use strict";
////////////////////////////////////////////////////////////////
// Generic Cordova Utilities
////////////////////////////////////////////////////////////////
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureLogger = exports.SecureLoggerCordovaInterface = void 0;
function noop() {
    return;
}
function cordovaExec(plugin, method, successCallback, errorCallback, args) {
    if (successCallback === void 0) { successCallback = noop; }
    if (errorCallback === void 0) { errorCallback = noop; }
    if (args === void 0) { args = []; }
    if (window.cordova) {
        window.cordova.exec(successCallback, errorCallback, plugin, method, args);
    }
    else {
        console.warn("".concat(plugin, ".").concat(method, "(...) :: cordova not available"));
        errorCallback && errorCallback("cordova_not_available");
    }
}
function cordovaExecPromise(plugin, method, args) {
    return new Promise(function (resolve, reject) {
        cordovaExec(plugin, method, resolve, reject, args);
    });
}
////////////////////////////////////////////////////////////////
// Plugin Interface
////////////////////////////////////////////////////////////////
var PLUGIN_NAME = 'SecureLoggerPlugin';
function invoke(method) {
    var args = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        args[_i - 1] = arguments[_i];
    }
    return cordovaExecPromise(PLUGIN_NAME, method, args);
}
function normalizeConfigureResult(value) {
    if (!value) {
        return { success: false, error: "invalid configure response: ".concat(value) };
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
var SecureLoggerCordovaInterface = /** @class */ (function () {
    function SecureLoggerCordovaInterface() {
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
    Object.defineProperty(SecureLoggerCordovaInterface.prototype, "maxCachedEvents", {
        /**
         * Maximum events allowed to be cached before
         * automatic pruning takes effect.
         * See `log()` for more info.
         */
        get: function () {
            return this.mMaxCachedEvents;
        },
        set: function (value) {
            this.mMaxCachedEvents = Math.max(1, Math.floor(value));
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Uses native-level formatting, and automatically inserts
     * newlines between events when writing formatted content to
     * the log cache.
     */
    SecureLoggerCordovaInterface.prototype.capture = function (events) {
        return invoke('capture', events);
    };
    /**
     * Writes the given text directly to the log cache
     * without any preprocessing.
     */
    SecureLoggerCordovaInterface.prototype.captureText = function (text) {
        return invoke('captureText', text);
    };
    /**
     * Deletes all logging cache files.
     * Cannot be undone, use with caution.
     */
    SecureLoggerCordovaInterface.prototype.clearCache = function () {
        return invoke('clearCache');
    };
    /**
     * Retrieves a single blob of log data which
     * contains all current log files stitched back
     * together chronologically.
     */
    SecureLoggerCordovaInterface.prototype.getCacheBlob = function () {
        return invoke('getCacheBlob');
    };
    /**
     * Customize how this plugin should operate.
     */
    SecureLoggerCordovaInterface.prototype.configure = function (options) {
        return invoke('configure', options)
            .then(normalizeConfigureResult)
            .then(unwrapConfigureResult);
    };
    /**
     * Completely disables event caching on this
     * interface, and clears any buffered events.
     * **NOTE**: convenience methods that use `log()` will
     * do nothing until caching is turned back on.
     */
    SecureLoggerCordovaInterface.prototype.disableEventCaching = function () {
        this.clearEventCacheFlushInterval();
        this.mEventCache = [];
    };
    /**
     * Stops the internal flush interval.
     * **NOTE**: convenience methods that use `log()` will
     * do nothing until the flush interval is turned back on.
     */
    SecureLoggerCordovaInterface.prototype.clearEventCacheFlushInterval = function () {
        if (this.mCacheFlushInterval) {
            clearInterval(this.mCacheFlushInterval);
        }
        this.mCacheFlushInterval = null;
    };
    /**
     * Sets the interval at which cached events will be flushed
     * and sent to the native logging system.
     * Default flush interval is 1000 milliseconds.
     */
    SecureLoggerCordovaInterface.prototype.setEventCacheFlushInterval = function (intervalMs) {
        if (intervalMs === void 0) { intervalMs = 1000; }
        this.clearEventCacheFlushInterval();
        this.mCacheFlushInterval = setInterval(this.flushEventCacheProxy, intervalMs);
        // flush immediately when this is updated
        this.onFlushEventCache();
    };
    /**
     * Adds the given event to the event cache,
     * which will be flushed on a fixed interval.
     */
    SecureLoggerCordovaInterface.prototype.queueEvent = function (ev) {
        this.mEventCache.push(ev);
        if (this.mEventCache.length > this.maxCachedEvents) {
            this.mEventCache.shift();
        }
    };
    /**
     * Generates a log event that will be cached for the next
     * event flush cycle, where all cached events will be handed to the plugin.
     * If this would cause the cache to become larger than `maxCachedEvents`,
     * the oldest item from the cache is removed after this new event is added.
     */
    SecureLoggerCordovaInterface.prototype.log = function (level, tag, message, timestamp) {
        if (timestamp === void 0) { timestamp = Date.now(); }
        this.queueEvent({ level: level, tag: tag, message: message, timestamp: timestamp });
    };
    /**
     * Queues a new log event with the given data and level of VERBOSE
     */
    SecureLoggerCordovaInterface.prototype.verbose = function (tag, message, timestamp) {
        this.log(2 /* SecureLogLevel.VERBOSE */, tag, message, timestamp);
    };
    /**
     * Queues a new log event with the given data and level of DEBUG
     */
    SecureLoggerCordovaInterface.prototype.debug = function (tag, message, timestamp) {
        this.log(3 /* SecureLogLevel.DEBUG */, tag, message, timestamp);
    };
    /**
     * Queues a new log event with the given data and level of DEBUG
     */
    SecureLoggerCordovaInterface.prototype.info = function (tag, message, timestamp) {
        this.log(4 /* SecureLogLevel.INFO */, tag, message, timestamp);
    };
    /**
     * Queues a new log event with the given data and level of WARN
     */
    SecureLoggerCordovaInterface.prototype.warn = function (tag, message, timestamp) {
        this.log(5 /* SecureLogLevel.WARN */, tag, message, timestamp);
    };
    /**
     * Queues a new log event with the given data and level of ERROR
     */
    SecureLoggerCordovaInterface.prototype.error = function (tag, message, timestamp) {
        this.log(6 /* SecureLogLevel.ERROR */, tag, message, timestamp);
    };
    /**
     * Queues a new log event with the given data and level of FATAL
     */
    SecureLoggerCordovaInterface.prototype.fatal = function (tag, message, timestamp) {
        this.log(7 /* SecureLogLevel.FATAL */, tag, message, timestamp);
    };
    /**
     * Alias of `verbose()`
     */
    SecureLoggerCordovaInterface.prototype.trace = function (tag, message, timestamp) {
        this.verbose(tag, message, timestamp);
    };
    SecureLoggerCordovaInterface.prototype.onFlushEventCacheSuccess = function () {
        this.mEventCache = [];
    };
    SecureLoggerCordovaInterface.prototype.onFlushEventCache = function () {
        if (this.mEventCache.length <= 0) {
            return;
        }
        this.capture(this.mEventCache)
            .then(this.flushEventCacheSuccessProxy)
            .catch(this.eventFlushErrorCallback);
    };
    return SecureLoggerCordovaInterface;
}());
exports.SecureLoggerCordovaInterface = SecureLoggerCordovaInterface;
/**
 * Singleton reference to interact with this cordova plugin
 */
exports.SecureLogger = new SecureLoggerCordovaInterface();
