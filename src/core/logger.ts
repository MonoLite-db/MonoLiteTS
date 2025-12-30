// Created by Yanjunhui

/**
 * Log levels
 */
export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Fatal = 4,
}

/**
 * Log entry structure
 */
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    message: string;
    context?: Record<string, any>;
}

/**
 * Logger interface
 */
export interface ILogger {
    debug(message: string, context?: Record<string, any>): void;
    info(message: string, context?: Record<string, any>): void;
    warn(message: string, context?: Record<string, any>): void;
    error(message: string, context?: Record<string, any>): void;
    fatal(message: string, context?: Record<string, any>): void;
}

/**
 * Default logger implementation
 */
class LoggerImpl implements ILogger {
    private minLevel: LogLevel;
    private name: string;

    constructor(name: string = 'MonoLite', minLevel: LogLevel = LogLevel.Info) {
        this.name = name;
        this.minLevel = minLevel;
    }

    private log(level: LogLevel, message: string, context?: Record<string, any>): void {
        if (level < this.minLevel) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            message,
            context,
        };

        const levelStr = LogLevel[level].toUpperCase();
        const timestamp = entry.timestamp.toISOString();
        const contextStr = context ? ` ${JSON.stringify(context)}` : '';

        const output = `[${timestamp}] ${levelStr} [${this.name}] ${message}${contextStr}`;

        switch (level) {
            case LogLevel.Debug:
                console.debug(output);
                break;
            case LogLevel.Info:
                console.info(output);
                break;
            case LogLevel.Warn:
                console.warn(output);
                break;
            case LogLevel.Error:
            case LogLevel.Fatal:
                console.error(output);
                break;
        }
    }

    debug(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Debug, message, context);
    }

    info(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Info, message, context);
    }

    warn(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Warn, message, context);
    }

    error(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Error, message, context);
    }

    fatal(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Fatal, message, context);
    }

    /**
     * Create a child logger with additional context
     */
    child(name: string): LoggerImpl {
        return new LoggerImpl(`${this.name}.${name}`, this.minLevel);
    }

    /**
     * Set minimum log level
     */
    setLevel(level: LogLevel): void {
        this.minLevel = level;
    }
}

/**
 * Global logger instance
 */
export const logger = new LoggerImpl();

/**
 * Static logger facade (for convenience)
 */
export const Logger = {
    debug: (message: string, context?: Record<string, any>) => logger.debug(message, context),
    info: (message: string, context?: Record<string, any>) => logger.info(message, context),
    warn: (message: string, context?: Record<string, any>) => logger.warn(message, context),
    error: (message: string, context?: Record<string, any>) => logger.error(message, context),
    fatal: (message: string, context?: Record<string, any>) => logger.fatal(message, context),
    child: (name: string) => logger.child(name),
    setLevel: (level: LogLevel) => logger.setLevel(level),
};
