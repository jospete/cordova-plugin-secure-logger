import Foundation
import CipherStreams

public let KEY_MAX_FILE_SIZE_BYTES = "maxFileSizeBytes"
public let KEY_MAX_TOTAL_CACHE_SIZE_BYTES = "maxTotalCacheSizeBytes"
public let KEY_MAX_FILE_COUNT = "maxFileCount"

private let LOG_FILE_NAME_PREFIX = "SCR-LOG-V"
private let LOG_FILE_NAME_EXTENSION = ".log"
private let RFS_SERIALIZER_VERSION = 1

extension String {
    
    // strips out the version from an existing file name so
    // we can check if the file is stale and should be deleted
    var fileSerializerVersion: Int? {
        if !self.starts(with: LOG_FILE_NAME_PREFIX) {
            return nil
        }
        
        let startIndex = self.index(self.startIndex, offsetBy: LOG_FILE_NAME_PREFIX.count)
        var endIndex = self.index(after: startIndex)
        
        while endIndex != self.endIndex && self[endIndex].isNumber {
            endIndex = self.index(after: endIndex)
        }
        
        return Int(self[startIndex..<endIndex])
    }
    
    func isSerializedWith(_ version: Int) -> Bool {
        return if let ownVersion = self.fileSerializerVersion {
            ownVersion == version
        } else {
            false
        }
    }
}

public class SecureLoggerFileStreamOptions {
    private var mMaxFileSizeBytes: UInt64 = 2 * 1000 * 1000 // 2MB
    private var mMaxTotalCacheSizeBytes: UInt64 = 8 * 1000 * 1000 // 8MB
    private var mMaxFileCount: Int = 20
    
    public var maxFileSizeBytes: UInt64 { mMaxFileSizeBytes }
    public var maxTotalCacheSizeBytes: UInt64 { mMaxTotalCacheSizeBytes }
    public var maxFileCount: Int { mMaxFileCount }
    
    public func copy() -> SecureLoggerFileStreamOptions {
        let result = SecureLoggerFileStreamOptions()
        result.mMaxFileSizeBytes = mMaxFileSizeBytes
        result.mMaxTotalCacheSizeBytes = mMaxTotalCacheSizeBytes
        result.mMaxFileCount = mMaxFileCount
        return result
    }
    
    @discardableResult
    public func tryUpdateMaxFileSizeBytes(_ value: Int) -> Bool {
        let min = 1000
        let max = 4 * 1000 * 1000
        let valid = (min...max).contains(value)
        if valid {
            mMaxFileSizeBytes = UInt64(value)
        }
        return valid
    }
    
    @discardableResult
    public func tryUpdateMaxTotalCacheSizeBytes(_ value: Int) -> Bool {
        let min = 1000
        let max = 64 * 1000 * 1000
        let valid = (min...max).contains(value)
        if valid {
            mMaxTotalCacheSizeBytes = UInt64(value)
        }
        return valid
    }
    
    @discardableResult
    public func tryUpdateMaxFileCount(_ value: Int) -> Bool {
        let min = 1
        let max = 100
        let valid = (min...max).contains(value)
        if valid {
            mMaxFileCount = value
        }
        return valid
    }
    
    public func toJSON() -> [String: Any] {
        return [
            KEY_MAX_FILE_SIZE_BYTES: maxFileSizeBytes,
            KEY_MAX_TOTAL_CACHE_SIZE_BYTES: maxTotalCacheSizeBytes,
            KEY_MAX_FILE_COUNT: maxFileCount
        ]
    }

    public func fromJSON(_ value: [String: Any]) -> SecureLoggerFileStreamOptions {
        if let maxFileSize = value[KEY_MAX_FILE_SIZE_BYTES] as? Int {
            tryUpdateMaxFileSizeBytes(maxFileSize)
        }
        if let maxCacheSize = value[KEY_MAX_TOTAL_CACHE_SIZE_BYTES] as? Int {
            tryUpdateMaxTotalCacheSizeBytes(maxCacheSize)
        }
        if let maxFileCount = value[KEY_MAX_FILE_COUNT] as? Int {
            tryUpdateMaxFileCount(maxFileCount)
        }
        return self
    }

    public func toDebugString() -> String {
        return "{ " +
            "maxFileSizeBytes = \(maxFileSizeBytes)" +
            ", maxTotalCacheSizeBytes = \(maxTotalCacheSizeBytes)" +
            ", maxFileCount = \(maxFileCount)" +
            " }"
    }
}

public class SecureLoggerFileStream {
    public enum Error : Swift.Error {
        case streamDestroyed
    }

    private let outputDirectory: URL
    private var _options: SecureLoggerFileStreamOptions
    private let mutex = NSLock()
    private var _destroyed = false
    private var activeFilePath: URL?
    private var activeStream: CipherOutputStream?

    init(_ outputDirectory: URL, options: SecureLoggerFileStreamOptions) {
        self.outputDirectory = outputDirectory
        self._options = options
    }

    private var maxFileSize: UInt64 {
        return self._options.maxFileSizeBytes
    }
    
    private var maxCacheSize: UInt64 {
        return self._options.maxTotalCacheSizeBytes
    }
    
    private var maxFileCount: Int {
        return self._options.maxFileCount
    }
    
    public var destroyed: Bool {
        return self._destroyed
    }
    
    public var options: SecureLoggerFileStreamOptions {
        get {
            self.mutex.lock()
            let result = self._options.copy()
            self.mutex.unlock()
            return result
        }
        set {
            self.mutex.lock()
            self._options = newValue
            self.mutex.unlock()
        }
    }
    
    public func destroy() {
        if !self.destroyed {
            self.mutex.lock()
            self._destroyed = true
            self.closeActiveStreamSync()
            self.mutex.unlock()
        }
    }

    public func appendLine(_ line: String) throws {
        if !line.isEmpty {
            try self.append(line + "\n")
        }
    }

    public func append(_ text: String) throws {
        try self.assertNotDestroyed()
        self.mutex.lock()
        if !text.isEmpty {
            let stream = try self.loadActiveStream()
            stream.writeUtf8(text)
        }
        self.mutex.unlock()
    }
    
    public func closeActiveStream() throws {
        self.mutex.lock()
        self.closeActiveStreamSync()
        self.mutex.unlock()
    }
    
    public func deleteAllCacheFiles() -> Bool {
        self.mutex.lock()
        self.closeActiveStreamSync()
        let result = self.outputDirectory.deleteFileSystemEntry()
            && self.outputDirectory.mkdirs()
        self.mutex.unlock()
        return result
    }
    
    public func getCacheBlob() throws -> [UInt8] {
        
        try self.assertNotDestroyed()
        
        self.mutex.lock()

        // Data at the end of the file will be partially corrupted if
        // the stream is not shut down, so need to close it before we can read it
        self.closeActiveStreamSync()

        var files = outputDirectory.listFiles()
        
        if files.count <= 0 {
            print("getCacheBlob() no files in cache!")
            return []
        }
        
        var accumulator = ""

        files.sort(by: SecureLoggerFileStream.fileNameComparator)
        var openedReadStream: InputStreamLike? = nil

        for file in files {
            do {
                openedReadStream = try openReadStream(file)
                let text = openedReadStream!.readAllText()
                print("read \(text.count) bytes")
                accumulator += text
                print("getCacheBlob() output size = \(accumulator.count)")
            } catch {
                openedReadStream = nil
                let errorMessage = "\n\n[[FILE DECRYPT FAILURE - " +
                    "${file.name} (${file.length()} bytes)]]" +
                    "\n<<<<<<<<<<<<<<<<\n\(error)\n>>>>>>>>>>>>>>>>\n\n"
                print("getCacheBlob() ERROR: \(errorMessage)")
                accumulator += errorMessage
            }
            
            openedReadStream?.close()
        }

        let resultBytes = Array(accumulator.utf8)
        self.mutex.unlock()
        
        return resultBytes
    }
    
    private func assertNotDestroyed() throws {
        if self.destroyed {
            throw Error.streamDestroyed
        }
    }

    private func generateArchiveFileName() -> String {
        // Generates a unique name like "SCR-LOG-V1-1698079640670.log"
        return "\(LOG_FILE_NAME_PREFIX)\(RFS_SERIALIZER_VERSION)-\(Date.nowMilliseconds)\(LOG_FILE_NAME_EXTENSION)"
    }
    
    private static func fileNameComparator(a: URL, b: URL) -> Bool {
        let comparisonResult = a.lastPathComponent.localizedStandardCompare(b.lastPathComponent)
        return comparisonResult == ComparisonResult.orderedAscending
    }

    private func openReadStream(_ filePath: URL) throws -> CipherInputStream {
        let startTime = Date.nowMilliseconds
        let encryptedFile = try AESEncryptedFile(filePath)
        let inputStream = try encryptedFile.openInputStream()
        print("logger input stream created in \(Date.nowMilliseconds - startTime) ms")
        return inputStream;
    }

    private func openWriteStream(_ filePath: URL) throws -> CipherOutputStream {
        let startTime = Date.nowMilliseconds
        let encryptedFile = try AESEncryptedFile(filePath)
        let outputStream = try encryptedFile.openOutputStream()
        print("logger output stream created in \(Date.nowMilliseconds - startTime) ms")
        return outputStream;
    }

    private func closeActiveStreamSync() {
        if let stream = activeStream {
            stream.close()
            activeStream = nil
        }
    }

    private func loadActiveStream() throws -> OutputStreamLike {
        if activeStream != nil
            && !activeStream!.hasCipherUpdateFailure
            && activeFilePath != nil
            && activeFilePath!.fileOrDirectoryExists()
            && activeFilePath!.fileLength() < maxFileSize {
            return activeStream!
        }

        normalizeFileCache()

        return try createNewStream()
    }

    private func createNewStream() throws -> OutputStreamLike {
        closeActiveStreamSync()

        let nextFileName = self.generateArchiveFileName()
        activeFilePath = outputDirectory.appendingPathComponent(nextFileName)

        if activeFilePath!.fileOrDirectoryExists() {
            if !activeFilePath!.deleteFileSystemEntry() {
                print("Failed to delete file at \(String(describing: activeFilePath))")
            }
        }

        activeStream = try openWriteStream(activeFilePath!)

        return activeStream!
    }

    private func normalizeFileCache() {
        if !outputDirectory.fileOrDirectoryExists() {
            if !outputDirectory.mkdirs() {
                print("Failed to create directory at \(String(describing: outputDirectory))")
            }
        }

        if (activeFilePath != nil
            && activeFilePath!.fileOrDirectoryExists()
            && activeFilePath!.fileLength() >= maxFileSize) {
            closeActiveStreamSync()
        }

        var files = outputDirectory
            .listFiles()
            .filter { $0.isRegularFile }
        
        if files.count <= 0 {
            return
        }

        files.sort(by: SecureLoggerFileStream.fileNameComparator)
        
        var deleteRetryCounter = 0
        
        // Step 1 - Purge any invalid files
        for i in (0...files.count-1).reversed() {
            let valid = files[i].lastPathComponent.isSerializedWith(RFS_SERIALIZER_VERSION)
            if valid == false {
                files[i].deleteFileSystemEntry()
                files.remove(at: i)
            }
        }
        
        // Step 2 - Purge files until we are under the max file count threshold
        while (files.count > 0 && files.count > maxFileCount) {
            files[0].deleteFileSystemEntry()
            files.remove(at: 0)
        }

        var totalFileSize: UInt64 = 0
        
        for fileUrl in files {
            totalFileSize += fileUrl.fileLength()
        }
        
        // Step 3 - Purge files until we are under the max cache size threshold
        while (files.count > 0 && totalFileSize > maxCacheSize) {
            totalFileSize -= files[0].fileLength()
            files[0].deleteFileSystemEntry()
            files.remove(at: 0)
        }
    }
}
