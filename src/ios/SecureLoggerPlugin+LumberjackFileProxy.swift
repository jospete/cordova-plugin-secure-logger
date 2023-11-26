import CocoaLumberjack

// Forwards native logs captured by Lumberjack into this plugin's file stream
public class SecureLoggerLumberjackFileProxy : DDAbstractLogger {
    
    private var fileStream: SecureLoggerFileStream
    private var _minLevel: LogLevel = .VERBOSE

    init(_ fileStream: SecureLoggerFileStream) {
        self.fileStream = fileStream
    }
    
    public var minLevel: LogLevel {
        get { _minLevel }
        set { _minLevel = newValue }
    }
    
    public var minLevelInt: Int {
        get { _minLevel.rawValue }
        set { _minLevel = newValue.toLogLevel() }
    }

    public override func log(message logMessage: DDLogMessage) {
        if logMessage.level.toPluginLevel().rawValue < minLevelInt {
            return
        }
        
        if let serializedEvent = logMessage.asSerializedNativeEvent() {
            do {
                try self.fileStream.appendLine(serializedEvent)
            } catch {
                print("Failed to append lumberjack log event to log file stream!")
            }
        }
    }
}
