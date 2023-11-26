import Foundation
import IDZSwiftCommonCrypto

public let KEY_MAX_FILE_SIZE_BYTES = "maxFileSizeBytes"
public let KEY_MAX_TOTAL_CACHE_SIZE_BYTES = "maxTotalCacheSizeBytes"
public let KEY_MAX_FILE_COUNT = "maxFileCount"

private let LOG_FILE_NAME_PREFIX = "SCR-LOG-V"
private let LOG_FILE_NAME_EXTENSION = ".log"
private let RFS_SERIALIZER_VERSION = 1

public class SecureLoggerFileStreamOptions {
    private var mMaxFileSizeBytes: UInt64 = 2 * 1000 * 1000 // 2MB
    private var mMaxTotalCacheSizeBytes: UInt64 = 7 * 1000 * 1000 // 8MB
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
    private let outputDirectory: URL
    private var _options: SecureLoggerFileStreamOptions
    private let mutex = NSLock()
    private var destroyed = false
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
        self.mutex.lock()
        self.destroyed = true
        self.closeActiveStream()
        self.mutex.unlock()
    }
    
    public func appendLine(_ line: String) throws {
        if !self.destroyed && !line.isEmpty {
            try self.append(line + "\n")
        }
    }

    public func append(_ text: String) throws {
        self.mutex.lock()
        if !self.destroyed && !text.isEmpty {
            if let stream = try self.loadActiveStream() {
                stream.writeUtf8(text)
            }
        }
        self.mutex.unlock()
    }
    
    public func deleteAllCacheFiles() -> Bool {
        self.mutex.lock()
        let result = !self.destroyed
            && self.outputDirectory.deleteFileSystemEntry()
            && self.outputDirectory.mkdirs()
        self.mutex.unlock()
        return result
    }
    
    public func getCacheBlob() -> [UInt8]? {
        
        if self.destroyed {
            print("getCacheBlob() stream is destroyed!")
            return nil;
        }
        
        self.mutex.lock()

        // Data at the end of the file will be partially corrupted if
        // the stream is not shut down, so need to close it before we can read it
        closeActiveStream()

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
        let password = try CryptoUtility.deriveStreamPassword(filePath.lastPathComponent)
        let encryptedFile = AESEncryptedFile(filePath, password: password)
        let inputStream = try encryptedFile.openInputStream()
        print("logger input stream created in \(Date.nowMilliseconds - startTime) ms")
        return inputStream;
    }

    private func openWriteStream(_ filePath: URL) throws -> CipherOutputStream {
        let startTime = Date.nowMilliseconds
        let password = try CryptoUtility.deriveStreamPassword(filePath.lastPathComponent)
        let encryptedFile = AESEncryptedFile(filePath, password: password)
        let outputStream = try encryptedFile.openOutputStream()
        print("logger output stream created in \(Date.nowMilliseconds - startTime) ms")
        return outputStream;
    }

    private func closeActiveStream() {
        if let stream = activeStream {
            stream.close()
            activeStream = nil
        }
    }

    private func loadActiveStream() throws -> OutputStreamLike? {
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

    private func createNewStream() throws -> OutputStreamLike? {
        closeActiveStream()

        let nextFileName = self.generateArchiveFileName()
        activeFilePath = outputDirectory.appendingPathComponent(nextFileName)

        if activeFilePath!.fileOrDirectoryExists() {
            if !activeFilePath!.deleteFileSystemEntry() {
                print("Failed to delete file at \(String(describing: activeFilePath))")
            }
        }

        activeStream = try openWriteStream(activeFilePath!)

        return activeStream
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
            closeActiveStream()
        }

        var files = outputDirectory
            .listFiles()
            .filter { $0.fileOrDirectoryExists() && $0.isRegularFile }

        files.sort(by: SecureLoggerFileStream.fileNameComparator)

        // TODO: may want to try consolidating log files together
        //      before deletion to avoid unnecessary data loss.
        
        var deleteRetryCounter = 0
        
        func trackFileRemovalRetry() {
            print("Failed to delete file at \(String(describing: files[0]))")
            deleteRetryCounter += 1
            if (deleteRetryCounter >= 3) {
                files.remove(at: 0)
                deleteRetryCounter = 0
            }
        }

        while (files.count > 0 && files.count > maxFileCount) {
            if files[0].deleteFileSystemEntry() {
                files.remove(at: 0)
            } else {
                trackFileRemovalRetry()
            }
        }

        var totalFileSize: UInt64 = 0
        
        for fileUrl in files {
            totalFileSize += fileUrl.fileLength()
        }

        while (files.count > 0 && totalFileSize > maxCacheSize) {
            let currentFileSize = files[0].fileLength()
            
            if files[0].deleteFileSystemEntry() {
                totalFileSize -= currentFileSize
                files.remove(at: 0)
            } else {
                trackFileRemovalRetry()
            }
        }
    }
}
