package com.obsidize.secure.logger

import android.os.Build
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import java.lang.Thread.UncaughtExceptionHandler

private const val LOG_DIR = "logs"
private const val LOG_CONFIG_FILE = "logs-config.json"
private const val ACTION_SET_DEBUG_OUTPUT_ENABLED = "setDebugOutputEnabled"
private const val ACTION_CAPTURE = "capture"
private const val ACTION_CAPTURE_TEXT = "captureText"
private const val ACTION_CLEAR_CACHE = "clearCache"
private const val ACTION_GET_CACHE_BLOB = "getCacheBlob"
private const val ACTION_CLOSE_ACTIVE_STREAM = "closeActiveStream"
private const val ACTION_CONFIGURE = "configure"
private const val ACTION_GET_DEBUG_STATE = "getDebugState"
private const val CONFIG_RESULT_KEY_SUCCESS = "success"
private const val CONFIG_RESULT_KEY_ERRORS = "errors"
private const val CONFIG_ERROR_KEY_OPTION = "option"
private const val CONFIG_ERROR_KEY_ERROR = "error"
private const val CONFIG_KEY_MIN_LEVEL = "minLevel"
private const val KEY_DEBUGGER_ATTACHED = "debuggerAttached"
private const val KEY_DEBUG_OUTPUT_ENABLED = "debugOutputEnabled"

class SecureLoggerPlugin : CordovaPlugin(), UncaughtExceptionHandler {
	private lateinit var rotatingFileStream: RotatingFileStream
	private lateinit var timberFileProxy: TimberFileProxy
	private lateinit var logsConfigFile: File
	private var defaultExceptionHandler: UncaughtExceptionHandler? = null
	private var timberDebug: Timber.DebugTree? = null
	private var debugOutputEnabled: Boolean = false

	override fun pluginInitialize() {
		super.pluginInitialize()

		// enable immediately so we don't lose startup log output
		setDebugOutputEnabled(true)

		val logDir = File(cordova.context.cacheDir.path, LOG_DIR)
		val streamOptions = RotatingFileStreamOptions(logDir)

		logsConfigFile = File(cordova.context.cacheDir.path, LOG_CONFIG_FILE)
		rotatingFileStream = RotatingFileStream(cordova.context, streamOptions)
		timberFileProxy = TimberFileProxy(rotatingFileStream)

		defaultExceptionHandler = Thread.getDefaultUncaughtExceptionHandler()
		Thread.setDefaultUncaughtExceptionHandler(this)

		tryLoadStoredConfig()
		Timber.plant(timberFileProxy)
	}

	override fun uncaughtException(t: Thread, e: Throwable) {
		Timber.e(e, "!!! UNCAUGHT NATIVE ERROR !!! -> on thread %s", t)
		// close active stream immediately, so next time plugin
		// starts up, it will have the stacktrace of the crash
		rotatingFileStream.closeActiveStream()
		defaultExceptionHandler?.uncaughtException(t, e)
	}

	override fun onPause(multitasking: Boolean) {
		super.onPause(multitasking)
		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.HONEYCOMB) {
			// onStop() is not guaranteed pre-v11, so seal off the active stream on pause.
			// NOTE: this may generate a large amount of "smaller" files if the app
			// comes in and out of the background frequently.
			rotatingFileStream.closeActiveStream()
		}
	}

	override fun onStop() {
		super.onStop()
		rotatingFileStream.closeActiveStream()
	}

	override fun onDestroy() {
		super.onDestroy()
		Timber.uproot(timberFileProxy)

		if (timberDebug != null) {
			Timber.uproot(timberDebug!!)
		}

		debugOutputEnabled = false
		rotatingFileStream.destroy()
	}

	override fun execute(
		action: String,
		args: JSONArray,
		callbackContext: CallbackContext
	): Boolean {
		Timber.v("execute action '$action'")
		when (action) {
			ACTION_GET_DEBUG_STATE -> {
				cordova.threadPool.execute {
					try {
						val result = JSONObject()
							.put(KEY_DEBUGGER_ATTACHED, isDebuggerAttached())
							.put(KEY_DEBUG_OUTPUT_ENABLED, debugOutputEnabled)
						callbackContext.success(result)
					} catch (ex: Exception) {
						onActionFailure(callbackContext, action, ex)
					}
				}
			}

			ACTION_SET_DEBUG_OUTPUT_ENABLED -> {
				cordova.threadPool.execute {
					try {
						val enabled = args.optBoolean(0)
						setDebugOutputEnabled(enabled)
						callbackContext.success()
					} catch (ex: Exception) {
						onActionFailure(callbackContext, action, ex)
					}
				}
			}

			ACTION_CAPTURE -> {
				cordova.threadPool.execute {
					try {
						val eventList = args.optJSONArray(0)
						captureLogEvents(eventList)
						callbackContext.success()
					} catch (ex: Exception) {
						onActionFailure(callbackContext, action, ex)
					}
				}
			}

			ACTION_CAPTURE_TEXT -> {
				cordova.threadPool.execute {
					try {
						val text = args.optString(0, "")
						rotatingFileStream.append(text)
						callbackContext.success()
					} catch (ex: Exception) {
						onActionFailure(callbackContext, action, ex)
					}
				}
			}

			ACTION_CLEAR_CACHE -> {
				cordova.threadPool.execute {
					try {
						val success = rotatingFileStream.deleteAllFiles()
						callbackContext.success(success.toString())
					} catch (ex: Exception) {
						onActionFailure(callbackContext, action, ex)
					}
				}
			}

			ACTION_CLOSE_ACTIVE_STREAM -> {
				cordova.threadPool.execute {
					try {
						rotatingFileStream.closeActiveStream()
						callbackContext.success()
					} catch (ex: Exception) {
						onActionFailure(callbackContext, action, ex)
					}
				}
			}

			ACTION_GET_CACHE_BLOB -> {
				cordova.threadPool.execute {
					try {
						val combinedBytes = rotatingFileStream.toBlob()
						callbackContext.success(combinedBytes)
					} catch (ex: Exception) {
						onActionFailure(callbackContext, action, ex)
					}
				}
			}

			ACTION_CONFIGURE -> {
				cordova.threadPool.execute {
					try {
						val options = args.optJSONObject(0)
						val result = applyConfigurationFromJson(options)
						callbackContext.success(result)
					} catch (ex: Exception) {
						onActionFailure(callbackContext, action, ex)
					}
				}
			}

			else -> {
				Timber.w("rejecting unsupported action '$action'")
				callbackContext.error("Action $action is not implemented in SecureLoggerPlugin.")
				return false
			}
		}
		return true
	}

	private fun onActionFailure(
		callbackContext: CallbackContext,
		action: String,
		ex: Exception
	) {
		Timber.e("failed plugin action '$action' -> ${ex.message}")
		callbackContext.error(ex.message)
	}

	private fun setDebugOutputEnabled(enabled: Boolean) {
		if (enabled == debugOutputEnabled) {
			return
		}

		if (timberDebug == null) {
			timberDebug = Timber.DebugTree()
		}

		if (enabled) {
			Timber.plant(timberDebug!!)
		} else {
			Timber.uproot(timberDebug!!)
		}

		debugOutputEnabled = enabled
	}

	private fun captureLogEvents(events: JSONArray?) {
		if (events == null || events.length() <= 0) {
			return
		}

		for (i in 0 until events.length()) {
			val ev: JSONObject = events.optJSONObject(i) ?: continue
			if (getWebEventLevel(ev) < timberFileProxy.minLevel) continue
			val text = serializeWebEventFromJSON(ev)
			rotatingFileStream.appendLine(text)
		}
	}

	private fun intOutOfBoundsError(key: String): JSONObject {
		return JSONObject()
			.put(CONFIG_ERROR_KEY_OPTION, key)
			.put(CONFIG_ERROR_KEY_ERROR, "value is outside of valid range")
	}

	private fun tryLoadStoredConfig() {
		try {
			if (!logsConfigFile.exists()) {
				Timber.v("no log config file found, using default configuration")
				return
			}
			val input = logsConfigFile.readText()
			val json = JSONObject(input)
			val storedOptions = rotatingFileStream.options.fromJSON(json)
			rotatingFileStream.options = storedOptions

			if (json.has(CONFIG_KEY_MIN_LEVEL)) {
				timberFileProxy.minLevel = json.optInt(CONFIG_KEY_MIN_LEVEL)
			}
		} catch (ex: Exception) {
			Timber.w("failed to load stored config: ${ex.message}")
		}
	}

	private fun trySaveCurrentConfig() {
		try {
			val outputJson = rotatingFileStream.options.toJSON()
			outputJson.put(CONFIG_KEY_MIN_LEVEL, timberFileProxy.minLevel)
			val output = outputJson.toString()
			logsConfigFile.writeText(output)
		} catch (ex: Exception) {
			Timber.w("failed to save current config: ${ex.message}")
		}
	}

	private fun applyConfigurationFromJson(config: JSONObject?): JSONObject {

		val result = JSONObject()

		if (config == null) {
			return result.put(CONFIG_RESULT_KEY_SUCCESS, true)
		}

		val errors = mutableListOf<JSONObject>()

		if (config.has(CONFIG_KEY_MIN_LEVEL)) {
			timberFileProxy.minLevel = config.getInt(CONFIG_KEY_MIN_LEVEL)
		}

		val streamOptions = rotatingFileStream.options
		var didUpdateOptions = false

		if (config.has(KEY_MAX_FILE_SIZE_BYTES)) {
			val value = config.getInt(KEY_MAX_FILE_SIZE_BYTES)
			if (streamOptions.tryUpdateMaxFileSizeBytes(value)) {
				didUpdateOptions = true
			} else {
				errors.add(intOutOfBoundsError(KEY_MAX_FILE_SIZE_BYTES))
			}
		}

		if (config.has(KEY_MAX_TOTAL_CACHE_SIZE_BYTES)) {
			val value = config.getInt(KEY_MAX_TOTAL_CACHE_SIZE_BYTES)
			if (streamOptions.tryUpdateMaxTotalCacheSizeBytes(value)) {
				didUpdateOptions = true
			} else {
				errors.add(intOutOfBoundsError(KEY_MAX_TOTAL_CACHE_SIZE_BYTES))
			}
		}

		if (config.has(KEY_MAX_FILE_COUNT)) {
			val value = config.getInt(KEY_MAX_FILE_COUNT)
			if (streamOptions.tryUpdateMaxFileCount(value)) {
				didUpdateOptions = true
			} else {
				errors.add(intOutOfBoundsError(KEY_MAX_FILE_COUNT))
			}
		}

		if (didUpdateOptions) {
			rotatingFileStream.options = streamOptions
			trySaveCurrentConfig()
		}

		result.put(CONFIG_RESULT_KEY_SUCCESS, errors.isEmpty())
		result.put(CONFIG_RESULT_KEY_ERRORS, JSONArray(errors))

		return result
	}
}
