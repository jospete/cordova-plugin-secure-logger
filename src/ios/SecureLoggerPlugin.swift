import Foundation
import CocoaLumberjack

let LOG_DIR = "logs"
let LOG_CONFIG_FILE = "logs-config.json"
let CONFIG_RESULT_KEY_SUCCESS = "success"
let CONFIG_RESULT_KEY_ERRORS = "errors"
let CONFIG_ERROR_KEY_OPTION = "option"
let CONFIG_ERROR_KEY_ERROR = "error"
let CONFIG_KEY_MIN_LEVEL = "minLevel"

@objc(SecureLoggerPlugin)
public class SecureLoggerPlugin : CDVPlugin {
    private var logsConfigFile: URL!
    private var fileStream: SecureLoggerFileStream!
    private var lumberjackProxy: SecureLoggerLumberjackFileProxy!
    
    @objc(pluginInitialize)
    public override func pluginInitialize() {
        super.pluginInitialize()
        
        let cachesDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        var appRootCacheDirectory = cachesDirectory
        
        if let appBundleId = Bundle.main.bundleIdentifier {
            appRootCacheDirectory = appRootCacheDirectory.appendingPathComponent(appBundleId)
        }
        
        let logsDirectory = appRootCacheDirectory.appendingPathComponent(LOG_DIR)
        print("using log directory \(logsDirectory)")
    
        let streamOptions = SecureLoggerFileStreamOptions()

        self.logsConfigFile = appRootCacheDirectory.appendingPathComponent(LOG_CONFIG_FILE)
        self.fileStream = SecureLoggerFileStream(logsDirectory, options: streamOptions)
        self.lumberjackProxy = SecureLoggerLumberjackFileProxy(self.fileStream!)
        
        tryLoadStoredConfig()
        DDLog.add(self.lumberjackProxy!)
        DDLogDebug("init success!")
    }
    
    @objc(onAppTerminate)
    override public func onAppTerminate() {
        DDLogDebug("running teardown actions...")
        self.fileStream.destroy()
        super.onAppTerminate()
    }

    @objc(capture:)
    func capture(command: CDVInvokedUrlCommand) {
        DispatchQueue.main.async(flags: .barrier) {
            if let eventList = command.arguments[0] as? [[String: Any]] {
                self.captureLogEvents(eventList)
                self.sendOk(command.callbackId)
            } else {
                self.sendError(command.callbackId, "input must be an array of events")
            }
        }
    }
    
    @objc(captureText:)
    func captureText(command: CDVInvokedUrlCommand) {
        DispatchQueue.main.async(flags: .barrier) {
            if let text = command.arguments[0] as? String {
                do {
                    try self.fileStream.append(text)
                    self.sendOk(command.callbackId)
                } catch {
                    print("Failed to capture webview text in log file!")
                    self.sendError(command.callbackId, "failed to capture log text")
                }
            } else {
                self.sendError(command.callbackId, "input must be a string")
            }
        }
    }
    
    @objc(clearCache:)
    func clearCache(command: CDVInvokedUrlCommand) {
        DispatchQueue.main.async(flags: .barrier) {
            let success = self.fileStream.deleteAllCacheFiles()
            print("clearCache success = \(success)")
            self.sendOk(command.callbackId, String(success))
      }
    }
    
    @objc(getCacheBlob:)
    func getCacheBlob(command: CDVInvokedUrlCommand) {
        DispatchQueue.main.async(flags: .barrier) {
            if let bytes = self.fileStream.getCacheBlob() {
                print("getCacheBlob() sending response with \(bytes.count) bytes")
                self.sendOkBytes(command.callbackId, bytes)
            } else {
                self.sendError(command.callbackId, "Failed to load cache blob")
            }
        }
    }

    @objc(configure:)
    func configure(command: CDVInvokedUrlCommand) {
        DispatchQueue.main.async(flags: .barrier) {
            if let configRequest = command.arguments[0] as? [String: Any] {
                let result = self.applyConfigurationFromJson(configRequest)
                self.sendOkJson(command.callbackId, result)
            } else {
                self.sendError(command.callbackId, "input must be an object")
            }
        }
    }

    private func sendOk(_ callbackId: String, _ message: String? = nil) {
        let pluginResult = CDVPluginResult(status: .ok, messageAs: message)
        self.commandDelegate.send(pluginResult, callbackId: callbackId)
    }
    
    private func sendOkBytes(_ callbackId: String, _ message: [UInt8]) {
        let pluginResult = CDVPluginResult(status: .ok, messageAsArrayBuffer: Data(message))
        self.commandDelegate.send(pluginResult, callbackId: callbackId)
    }
    
    private func sendOkJson(_ callbackId: String, _ obj: [String: Any]) {
        let pluginResult = CDVPluginResult(status: .ok, messageAs: obj)
        self.commandDelegate.send(pluginResult, callbackId: callbackId)
    }
    
    private func sendError(_ callbackId: String, _ message: String? = nil) {
        let pluginResult = CDVPluginResult(status: .error, messageAs: message)
        self.commandDelegate.send(pluginResult, callbackId: callbackId)
    }

    private func captureLogEvents(_ eventList: [[String: Any]]) {
        for logEvent in eventList {
            do {
                if let level = logEvent.getWebEventLevel(), level >= lumberjackProxy.minLevelInt {
                    let logLine = logEvent.asSerializedWebEvent()
                    try fileStream.appendLine(logLine)
                }
            } catch {
                print("Failed to capture webview event in log file!")
            }
        }
    }
    
    private func trySaveCurrentConfig() {
        var output = fileStream.options.toJSON()
        output[CONFIG_KEY_MIN_LEVEL] = lumberjackProxy.minLevelInt
        
        if !logsConfigFile.writeJson(output) {
            DDLogWarn("failed to save current config")
        }
    }
    
    private func tryLoadStoredConfig() {
        guard let input = logsConfigFile.readJson() else {
            DDLogWarn("failed to load stored config")
            return
        }
        
        let storedOptions = fileStream.options.fromJSON(input)
        fileStream.options = storedOptions

        if let minLevelInt = input[CONFIG_KEY_MIN_LEVEL] as? Int {
            print("updating minLevel to \(minLevelInt) (from storage)")
            lumberjackProxy.minLevelInt = minLevelInt
            print("minLevel set to \(lumberjackProxy.minLevelInt)")
        }
    }
    
    private func intOutOfBoundsError(_ key: String) -> [String: Any] {
        return [
            CONFIG_ERROR_KEY_OPTION: key,
            CONFIG_ERROR_KEY_ERROR: "value is outside of valid range"
        ]
    }

    private func applyConfigurationFromJson(_ webviewArg: [String: Any]?) -> [String: Any] {

        var result: [String: Any] = [:]
        
        guard let config = webviewArg else {
            result[CONFIG_RESULT_KEY_SUCCESS] = true
            return result
        }

         var errors = Array<[String: Any]>()

         if let minLevelInt = config[CONFIG_KEY_MIN_LEVEL] as? Int {
             print("update minLevel = \(minLevelInt)")
             lumberjackProxy.minLevelInt = minLevelInt
             print("minLevel set to \(lumberjackProxy.minLevelInt)")
         }

         let streamOptions = fileStream.options
         var didUpdateOptions = false

         if let maxFileSizeBytes = config[KEY_MAX_FILE_SIZE_BYTES] as? Int {
             if streamOptions.tryUpdateMaxFileSizeBytes(maxFileSizeBytes) {
                 print("update maxFileSizeBytes = \(maxFileSizeBytes)")
                 didUpdateOptions = true
             } else {
                 errors.append(intOutOfBoundsError(KEY_MAX_FILE_SIZE_BYTES))
             }
         }
        
        if let maxTotalCacheSizeBytes = config[KEY_MAX_TOTAL_CACHE_SIZE_BYTES] as? Int {
            if streamOptions.tryUpdateMaxTotalCacheSizeBytes(maxTotalCacheSizeBytes) {
                print("update maxTotalCacheSizeBytes = \(maxTotalCacheSizeBytes)")
                didUpdateOptions = true
            } else {
                errors.append(intOutOfBoundsError(KEY_MAX_TOTAL_CACHE_SIZE_BYTES))
            }
        }
        
        if let maxFileCount = config[KEY_MAX_FILE_COUNT] as? Int {
            if streamOptions.tryUpdateMaxFileCount(maxFileCount) {
                print("update maxFileCount = \(maxFileCount)")
                didUpdateOptions = true
            } else {
                errors.append(intOutOfBoundsError(KEY_MAX_FILE_COUNT))
            }
        }

        if didUpdateOptions {
            fileStream.options = streamOptions
            let originDump = streamOptions.toDebugString()
            let optionsDump = fileStream.options.toDebugString()
            print("from options: \(originDump)")
            print("  to options: \(optionsDump)")
            DDLogInfo("file stream reconfigured with new options: \(optionsDump)")
            trySaveCurrentConfig()
        }
        
        result[CONFIG_RESULT_KEY_SUCCESS] = errors.count <= 0
        result[CONFIG_RESULT_KEY_ERRORS] = errors

        return result
     }
}
