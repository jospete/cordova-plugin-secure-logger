import Foundation
import CocoaLumberjack

private let LOG_DIR = "logs"
private let LOG_CONFIG_FILE = "logs-config.json"
private let CONFIG_RESULT_KEY_SUCCESS = "success"
private let CONFIG_RESULT_KEY_ERRORS = "errors"
private let CONFIG_ERROR_KEY_OPTION = "option"
private let CONFIG_ERROR_KEY_ERROR = "error"
private let CONFIG_KEY_MIN_LEVEL = "minLevel"
private let KEY_DEBUGGER_ATTACHED = "debuggerAttached"
private let KEY_DEBUG_OUTPUT_ENABLED = "debugOutputEnabled"
private let MIN_CYCLE_WAIT_MS = 30 * 1000; // 30 seconds

private var secureLoggerBaseExceptionHandler: (@convention(c) (NSException) -> Void)? = nil
private var secureLoggerPluginInstance: SecureLoggerPlugin? = nil

private func secureLoggerOverrideExceptionHandler(exception: NSException) -> Void {
    let prettyStackTrace = exception.callStackSymbols.joined(separator: "\n")
    DDLogError("Uncaught Native Error! -> \(prettyStackTrace)")
    // close active stream immediately, so next time plugin
    // starts up, it will have the stacktrace of the crash
    secureLoggerPluginInstance?.closeActiveStreamNative()
    secureLoggerBaseExceptionHandler?(exception)
}

@objc(SecureLoggerPlugin)
public class SecureLoggerPlugin : CDVPlugin {
    private var logsConfigFile: URL!
    private var fileStream: SecureLoggerFileStream!
    private var lumberjackProxy: SecureLoggerLumberjackFileProxy!
    private var debugOutputEnabled: Bool = false
    private var upTimeStart: Int = Date.nowMilliseconds
    
    @objc(pluginInitialize)
    public override func pluginInitialize() {
        super.pluginInitialize()
        
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onPause), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(onResume), name: UIApplication.willEnterForegroundNotification, object: nil)
        
        // enable immediately so we don't lose startup log output
        self.setDebugOutputEnabledInternal(true)
        
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
        
        if secureLoggerBaseExceptionHandler == nil {
            secureLoggerBaseExceptionHandler = NSGetUncaughtExceptionHandler()
        }
        
        if secureLoggerPluginInstance == nil {
            secureLoggerPluginInstance = self
            NSSetUncaughtExceptionHandler(secureLoggerOverrideExceptionHandler)
        }
        
        tryLoadStoredConfig()
        DDLog.add(self.lumberjackProxy!)
    }
    
    @discardableResult
    func closeActiveStreamNative() -> Bool {
        do {
            try self.fileStream.closeActiveStream()
            return true
        } catch {
            return false
        }
    }
    
    @objc(onAppTerminate)
    override public func onAppTerminate() {
        DDLogDebug("running teardown actions...")
        self.fileStream.destroy()
        super.onAppTerminate()
    }
    
    @objc(onPause)
    func onPause() {
        if (Date.nowMilliseconds - upTimeStart) >= MIN_CYCLE_WAIT_MS {
            self.closeActiveStreamNative()
        }
    }
    
    @objc(onResume)
    func onResume() {
        upTimeStart = Date.nowMilliseconds
    }

    @objc(getDebugState:)
    func getDebugState(command: CDVInvokedUrlCommand) {
        DispatchQueue.main.async(flags: .barrier) {
            self.sendOkJson(command.callbackId, [
                KEY_DEBUGGER_ATTACHED: isDebuggerAttached(),
                KEY_DEBUG_OUTPUT_ENABLED: self.debugOutputEnabled
            ])
        }
    }
    
    @objc(setDebugOutputEnabled:)
    func setDebugOutputEnabled(command: CDVInvokedUrlCommand) {
        DispatchQueue.main.async(flags: .barrier) {
            if let enabled = command.arguments[0] as? Bool {
                self.setDebugOutputEnabledInternal(enabled)
                self.sendOk(command.callbackId)
            } else {
                self.sendError(command.callbackId, "input must be a boolean")
            }
        }
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
            do {
                let bytes = try self.fileStream.getCacheBlob()
                print("getCacheBlob() sending response with \(bytes.count) bytes")
                self.sendOkBytes(command.callbackId, bytes)
            } catch {
                self.sendError(command.callbackId, String(describing: error))
            }
        }
    }

    @objc(closeActiveStream:)
    func closeActiveStream(command: CDVInvokedUrlCommand) {
        DispatchQueue.main.async(flags: .barrier) {
            do {
                try self.fileStream.closeActiveStream()
                self.sendOk(command.callbackId)
            } catch {
                self.sendError(command.callbackId, String(describing: error))
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
    
    private func setDebugOutputEnabledInternal(_ enabled: Bool) {
        if enabled == self.debugOutputEnabled {
            return
        }
        
        if enabled {
            DDLog.add(DDOSLogger.sharedInstance) // Use os_log
        } else {
            DDLog.remove(DDOSLogger.sharedInstance)
        }
        
        self.debugOutputEnabled = enabled
    }

    private func captureLogEvents(_ eventList: [[String: Any]?]) {
        for logEvent in eventList {
            guard let level = logEvent?.getWebEventLevel() else { continue }
            if level < lumberjackProxy.minLevelInt { continue }
            guard let logLine = logEvent?.asSerializedWebEvent() else { continue }
            try? fileStream.appendLine(logLine)
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
        if !logsConfigFile.fileOrDirectoryExists() {
            DDLogVerbose("no log config file found, using default configuration")
            return
        }
        
        guard let input = logsConfigFile.readJson() else {
            DDLogWarn("failed to load stored config")
            return
        }
        
        let storedOptions = fileStream.options.fromJSON(input)
        fileStream.options = storedOptions

        if let minLevelInt = input[CONFIG_KEY_MIN_LEVEL] as? Int {
            lumberjackProxy.minLevelInt = minLevelInt
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
             lumberjackProxy.minLevelInt = minLevelInt
         }

         let streamOptions = fileStream.options
         var didUpdateOptions = false

         if let maxFileSizeBytes = config[KEY_MAX_FILE_SIZE_BYTES] as? Int {
             if streamOptions.tryUpdateMaxFileSizeBytes(maxFileSizeBytes) {
                 didUpdateOptions = true
             } else {
                 errors.append(intOutOfBoundsError(KEY_MAX_FILE_SIZE_BYTES))
             }
         }
        
        if let maxTotalCacheSizeBytes = config[KEY_MAX_TOTAL_CACHE_SIZE_BYTES] as? Int {
            if streamOptions.tryUpdateMaxTotalCacheSizeBytes(maxTotalCacheSizeBytes) {
                didUpdateOptions = true
            } else {
                errors.append(intOutOfBoundsError(KEY_MAX_TOTAL_CACHE_SIZE_BYTES))
            }
        }
        
        if let maxFileCount = config[KEY_MAX_FILE_COUNT] as? Int {
            if streamOptions.tryUpdateMaxFileCount(maxFileCount) {
                didUpdateOptions = true
            } else {
                errors.append(intOutOfBoundsError(KEY_MAX_FILE_COUNT))
            }
        }

        if didUpdateOptions {
            fileStream.options = streamOptions
            trySaveCurrentConfig()
        }
        
        result[CONFIG_RESULT_KEY_SUCCESS] = errors.count <= 0
        result[CONFIG_RESULT_KEY_ERRORS] = errors

        return result
     }
}
