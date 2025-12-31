// Created by Yanjunhui

/**
 * 日志级别
 * EN: Log levels
 */
export enum LogLevel {
    /** 调试 EN: Debug */
    Debug = 0,
    /** 信息 EN: Info */
    Info = 1,
    /** 警告 EN: Warn */
    Warn = 2,
    /** 错误 EN: Error */
    Error = 3,
    /** 致命 EN: Fatal */
    Fatal = 4,
}

/**
 * 日志条目结构
 * EN: Log entry structure
 */
export interface LogEntry {
    /** 时间戳 EN: Timestamp */
    timestamp: Date;
    /** 日志级别 EN: Log level */
    level: LogLevel;
    /** 消息 EN: Message */
    message: string;
    /** 上下文 EN: Context */
    context?: Record<string, any>;
}

/**
 * 日志器接口
 * EN: Logger interface
 */
export interface ILogger {
    debug(message: string, context?: Record<string, any>): void;
    info(message: string, context?: Record<string, any>): void;
    warn(message: string, context?: Record<string, any>): void;
    error(message: string, context?: Record<string, any>): void;
    fatal(message: string, context?: Record<string, any>): void;
}

/**
 * 默认日志器实现
 * EN: Default logger implementation
 */
class LoggerImpl implements ILogger {
    /** 最小日志级别 EN: Minimum log level */
    private minLevel: LogLevel;
    /** 日志器名称 EN: Logger name */
    private name: string;

    constructor(name: string = 'MonoLite', minLevel: LogLevel = LogLevel.Info) {
        this.name = name;
        this.minLevel = minLevel;
    }

    /**
     * 输出日志
     * EN: Output log
     */
    private log(level: LogLevel, message: string, context?: Record<string, any>): void {
        // 低于最小级别则不输出
        // EN: Skip if below minimum level
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

    /**
     * 调试日志
     * EN: Debug log
     */
    debug(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Debug, message, context);
    }

    /**
     * 信息日志
     * EN: Info log
     */
    info(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Info, message, context);
    }

    /**
     * 警告日志
     * EN: Warning log
     */
    warn(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Warn, message, context);
    }

    /**
     * 错误日志
     * EN: Error log
     */
    error(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Error, message, context);
    }

    /**
     * 致命错误日志
     * EN: Fatal log
     */
    fatal(message: string, context?: Record<string, any>): void {
        this.log(LogLevel.Fatal, message, context);
    }

    /**
     * 创建带有额外上下文的子日志器
     * EN: Create a child logger with additional context
     */
    child(name: string): LoggerImpl {
        return new LoggerImpl(`${this.name}.${name}`, this.minLevel);
    }

    /**
     * 设置最小日志级别
     * EN: Set minimum log level
     */
    setLevel(level: LogLevel): void {
        this.minLevel = level;
    }
}

/**
 * 全局日志器实例
 * EN: Global logger instance
 */
export const logger = new LoggerImpl();

/**
 * 静态日志器门面（便于使用）
 * EN: Static logger facade (for convenience)
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
