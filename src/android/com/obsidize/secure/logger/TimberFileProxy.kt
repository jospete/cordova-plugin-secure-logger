package com.obsidize.secure.logger

import android.util.Log
import timber.log.Timber

class TimberFileProxy(
    private val stream: RotatingFileStream
) : Timber.DebugTree() {

	private var _minLevel = Log.VERBOSE

	var minLevel: Int
		get() = _minLevel
		set(value) {
			_minLevel = clampLogLevel(value)
		}

    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        if (priority >= _minLevel) {
			val text = serializeNativeEvent(priority, tag, message, t)
			stream.appendLine(text)
		}
    }
}
