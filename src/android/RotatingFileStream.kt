package com.obsidize.secure.logger

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

const val KEY_MAX_FILE_SIZE_BYTES = "maxFileSizeBytes"
const val KEY_MAX_TOTAL_CACHE_SIZE_BYTES = "maxTotalCacheSizeBytes"
const val KEY_MAX_FILE_COUNT = "maxFileCount"

private const val LOG_FILE_NAME_PREFIX = "SCR-LOG-V"
private const val LOG_FILE_NAME_EXTENSION = ".log"
private const val RFS_SERIALIZER_VERSION = 1

// strips out the version from an existing file name so
// we can check if the file is stale and should be deleted
val String.serializerVersion: Int?
	get() {
		if (!this.startsWith(LOG_FILE_NAME_PREFIX)) {
			return null
		}

		val startIndex = LOG_FILE_NAME_PREFIX.length
		var endIndex = startIndex + 1

		while (endIndex < this.length && this[endIndex].isDigit()) {
			endIndex++
		}

		return try {
			this.substring(startIndex, endIndex).toIntOrNull()
		} catch (_: Exception) {
			null
		}
	}

fun String.isSerializedWith(version: Int): Boolean {
	val ownVersion = this.serializerVersion
	return ownVersion != null && ownVersion == version
}

data class RotatingFileStreamOptions(
	val outputDir: File,
	var maxFileSizeBytes: Long = 2 * 1000 * 1000, // 2MB
	var maxTotalCacheSizeBytes: Long = 8 * 1000 * 1000, // 8MB
	var maxFileCount: Long = 20
)

fun RotatingFileStreamOptions.tryUpdateMaxFileSizeBytes(value: Int): Boolean {
	val min = 1000
	val max = 4 * 1000 * 1000
	val valid = value in min..max
	if (valid) maxFileSizeBytes = value.toLong()
	return valid
}

fun RotatingFileStreamOptions.tryUpdateMaxTotalCacheSizeBytes(value: Int): Boolean {
	val min = 1000
	val max = 64 * 1000 * 1000
	val valid = value in min..max
	if (valid) maxTotalCacheSizeBytes = value.toLong()
	return valid
}

fun RotatingFileStreamOptions.tryUpdateMaxFileCount(value: Int): Boolean {
	val min = 1
	val max = 100
	val valid = value in min..max
	if (valid) maxFileCount = value.toLong()
	return valid
}

fun RotatingFileStreamOptions.fromJSON(value: JSONObject): RotatingFileStreamOptions {
	tryUpdateMaxFileSizeBytes(value.optInt(KEY_MAX_FILE_SIZE_BYTES))
	tryUpdateMaxTotalCacheSizeBytes(value.optInt(KEY_MAX_TOTAL_CACHE_SIZE_BYTES))
	tryUpdateMaxFileCount(value.optInt(KEY_MAX_FILE_COUNT))
	return this
}

fun RotatingFileStreamOptions.toJSON(): JSONObject {
	return JSONObject()
		.put(KEY_MAX_FILE_SIZE_BYTES, maxFileSizeBytes)
		.put(KEY_MAX_TOTAL_CACHE_SIZE_BYTES, maxTotalCacheSizeBytes)
		.put(KEY_MAX_FILE_COUNT, maxFileCount)
}

fun RotatingFileStreamOptions.toDebugString(): String {
	return "{ " +
		"maxFileSizeBytes = $maxFileSizeBytes" +
		", maxTotalCacheSizeBytes = $maxTotalCacheSizeBytes" +
		", maxFileCount = $maxFileCount" +
		" }"
}

class RotatingFileStreamDestroyedException(
	message: String = "RotatingFileStream is destroyed"
) : Exception(message) {
}

class RotatingFileStream(
	private val mContext: Context,
	private var mOptions: RotatingFileStreamOptions
) {
	private val mLock = Any()

	private val mMasterKey = MasterKey.Builder(mContext)
		.setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
		.build()

	private var mActiveFile: File? = null
	private var mActiveStream: FileOutputStream? = null
	private var mDestroyed: Boolean = false

	private val output: File
		get() = options.outputDir

	private val maxFileSize: Long
		get() = options.maxFileSizeBytes

	private val maxFileCount: Long
		get() = options.maxFileCount

	private val maxCacheSize: Long
		get() = options.maxTotalCacheSizeBytes

	val destroyed: Boolean
		get() = mDestroyed

	var options: RotatingFileStreamOptions
		get() {
			synchronized(mLock) {
				return mOptions.copy()
			}
		}
		set(value) {
			synchronized(mLock) {
				mOptions = value
			}
		}

	fun destroy() {
		if (!mDestroyed) {
			synchronized(mLock) {
				mDestroyed = true
				closeActiveStreamSync()
			}
		}
	}

	@Throws(
		java.io.IOException::class,
		java.lang.SecurityException::class,
		java.security.GeneralSecurityException::class,
		RotatingFileStreamDestroyedException::class
	)
	fun appendLine(text: String) {
		if (text.isNotEmpty()) {
			append(text + "\n")
		}
	}

	@Throws(
		java.lang.SecurityException::class
	)
	fun deleteAllFiles(): Boolean {
		synchronized(mLock) {
			closeActiveStreamSync()
			return output.deleteRecursively() && output.mkdirs()
		}
	}

	@Throws(java.io.IOException::class)
	fun closeActiveStream() {
		synchronized(mLock) {
			closeActiveStreamSync()
		}
	}

	@Throws(
		java.io.IOException::class,
		java.lang.SecurityException::class,
		java.security.GeneralSecurityException::class,
		RotatingFileStreamDestroyedException::class
	)
	fun append(text: String) {
		synchronized(mLock) {
			assertNotDestroyed()
			if (text.isNotEmpty()) {
				val stream = loadActiveStream()
				stream.write(text.toByteArray())
				stream.flush()
			}
		}
	}

	@Throws(
		java.io.IOException::class,
		java.security.GeneralSecurityException::class,
		RotatingFileStreamDestroyedException::class
	)
	fun toBlob(): ByteArray {
		synchronized(mLock) {

			assertNotDestroyed()

			// Data at the end of the file will be partially corrupted if
			// the stream is not shut down, so need to close it before we can read it
			closeActiveStreamSync()

			val files: Array<File> = output.listFiles() ?: arrayOf()
			val outputStream = ByteArrayOutputStream()

			if (files.isEmpty()) {
				return outputStream.toByteArray()
			}

			files.sortWith { a, b -> a.name.compareTo(b.name) }
			var readStream: FileInputStream? = null

			for (file in files) {
				try {
					readStream = openReadStream(file)
					readStream.pipeTo(outputStream)
				} catch (ex: Exception) {
					val errorMessage = "\n\n[[FILE DECRYPT FAILURE - " +
						"${file.name} (${file.length()} bytes)]]\n<<<<<<<<<<<<<<<<\n" +
						ex.message +
						"\n>>>>>>>>>>>>>>>>\n\n"
					outputStream.write(errorMessage.toByteArray())
				} finally {
					readStream?.close()
				}
			}

			return outputStream.toByteArray()
		}
	}

	@Throws(RotatingFileStreamDestroyedException::class)
	private fun assertNotDestroyed() {
		if (mDestroyed) {
			throw RotatingFileStreamDestroyedException()
		}
	}

	private fun closeActiveStreamSync() {
		if (mActiveStream != null) {
			mActiveStream!!.flush()
			mActiveStream!!.close()
			mActiveStream = null
		}
	}

	private fun generateArchiveFileName(): String {
		// Generates a unique name like "SCR-LOG-V1-1698079640670.log"
		return LOG_FILE_NAME_PREFIX +
			RFS_SERIALIZER_VERSION +
			"-" +
			currentTimeMillis() +
			LOG_FILE_NAME_EXTENSION
	}

	@Throws(
		java.io.IOException::class,
		java.security.GeneralSecurityException::class
	)
	private fun openReadStream(file: File): FileInputStream {
		return wrapEncryptedFile(file).openFileInput()
	}

	@Throws(
		java.io.IOException::class,
		java.security.GeneralSecurityException::class
	)
	private fun openWriteStream(file: File): FileOutputStream {
		return wrapEncryptedFile(file).openFileOutput()
	}

	@Throws(
		java.io.IOException::class,
		java.security.GeneralSecurityException::class
	)
	private fun wrapEncryptedFile(file: File): EncryptedFile {
		return EncryptedFile.Builder(
			mContext,
			file,
			mMasterKey,
			EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB
		).build()
	}

	@Throws(
		java.io.IOException::class,
		java.lang.SecurityException::class,
		java.security.GeneralSecurityException::class
	)
	private fun loadActiveStream(): FileOutputStream {
		if (mActiveStream != null
			&& mActiveFile != null
			&& mActiveFile!!.exists()
			&& mActiveFile!!.length() < maxFileSize
		)
			return mActiveStream!!

		normalizeFileCache()

		return createNewStream()
	}

	@Throws(
		java.io.IOException::class,
		java.lang.SecurityException::class,
		java.security.GeneralSecurityException::class
	)
	private fun createNewStream(): FileOutputStream {
		closeActiveStreamSync()

		mActiveFile = File(output.path, generateArchiveFileName())

		if (mActiveFile!!.exists())
			mActiveFile!!.delete()

		mActiveStream = openWriteStream(mActiveFile!!)

		return mActiveStream!!
	}

	@Throws(
		java.io.IOException::class,
		java.lang.SecurityException::class
	)
	private fun normalizeFileCache() {
		if (!output.exists())
			output.mkdirs()

		if (mActiveFile != null
			&& mActiveFile!!.exists()
			&& mActiveFile!!.length() >= maxFileSize
		) {
			closeActiveStreamSync()
		}

		val files: MutableList<File> = output
			.listFiles()
			?.filter { f: File? -> (f != null) && f.exists() && f.isFile }
			?.toMutableList()
			?: mutableListOf()

		if (files.isEmpty()) {
			return
		}

		files.sortWith { a, b -> a.name.compareTo(b.name) }

		// Step 1 - Purge any invalid files
		for (i in files.count() - 1 downTo 0) {
			val valid = files[i].name.isSerializedWith(RFS_SERIALIZER_VERSION)
			if (!valid) {
				files[i].delete()
				files.removeAt(i)
			}
		}

		// Step 2 - Purge files until we are under the max file count threshold
		while (files.isNotEmpty() && files.size > maxFileCount) {
			files[0].delete()
			files.removeAt(0)
		}

		var totalFileSize = files.sumOf { it.length() }

		// Step 3 - Purge files until we are under the max cache size threshold
		while (files.isNotEmpty() && totalFileSize > maxCacheSize) {
			totalFileSize -= files[0].length()
			files[0].delete()
			files.removeAt(0)
		}
	}
}
