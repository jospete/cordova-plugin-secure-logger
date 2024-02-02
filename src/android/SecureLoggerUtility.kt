package com.obsidize.secure.logger

import android.util.Log
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Objects
import java.util.TimeZone

private const val DEFAULT_BUFFER_SIZE = 8192

private const val PRIORITY_VERBOSE = "TRACE"
private const val PRIORITY_DEBUG = "DEBUG"
private const val PRIORITY_INFO = "INFO"
private const val PRIORITY_WARN = "WARN"
private const val PRIORITY_ERROR = "ERROR"
private const val PRIORITY_ASSERT = "FATAL"
const val NO_TAG = "NO_TAG"
const val MISSING_MESSAGE = "<MISSING_MESSAGE>"

private val iso8601 = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
private val timezoneUtc = TimeZone.getTimeZone("UTC")

fun timestampOf(date: Date): String {
	iso8601.timeZone = timezoneUtc
	return iso8601.format(date)
}

fun currentTimeMillis(): Long {
	return Date().time
}

fun clampInt(value: Int, min: Int, max: Int): Int {
	if (value < min) return min
	if (value > max) return max
	return value
}

fun clampLogLevel(level: Int): Int {
	return clampInt(level, Log.VERBOSE, Log.ASSERT)
}

fun serializeLogLevel(priority: Int): String {
	return when (priority) {
		Log.VERBOSE -> PRIORITY_VERBOSE
		Log.DEBUG -> PRIORITY_DEBUG
		Log.INFO -> PRIORITY_INFO
		Log.WARN -> PRIORITY_WARN
		Log.ERROR -> PRIORITY_ERROR
		Log.ASSERT -> PRIORITY_ASSERT
		else -> PRIORITY_DEBUG
	}
}

fun serializeNativeEvent(priority: Int, tag: String?, message: String, t: Throwable?): String {
	val timestamp = timestampOf(Date())
	val throwDump = if (t != null) " :: ${t.stackTrace}" else ""
	return "$timestamp [${serializeLogLevel(priority)}] [${tag ?: NO_TAG}] $message$throwDump"
}

fun serializeWebEvent(timestampMillis: Long, level: Int, tag: String, message: String): String {
	val timestamp = timestampOf(Date(timestampMillis))
	return "$timestamp [${serializeLogLevel(level)}] [webview-$tag] $message"
}

fun getWebEventLevel(obj: JSONObject): Int {
	return obj.optInt("level", Log.DEBUG)
}

fun serializeWebEventFromJSON(obj: JSONObject): String {

	var timestamp = obj.optLong("timestamp", -1)
	val level = getWebEventLevel(obj)
	val tag = obj.optString("tag", NO_TAG)
	val message = obj.optString("message", MISSING_MESSAGE)

	if (timestamp < 0)
		timestamp = currentTimeMillis()

	return serializeWebEvent(timestamp, level, tag, message)
}

@Throws(IOException::class)
fun InputStream.pipeTo(out: OutputStream): Long {
	Objects.requireNonNull(out, "out")
	var transferred: Long = 0
	val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
	var read: Int
	while (this.read(buffer, 0, DEFAULT_BUFFER_SIZE).also { read = it } >= 0) {
		out.write(buffer, 0, read)
		transferred += read.toLong()
	}
	return transferred
}
