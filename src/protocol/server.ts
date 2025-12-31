// Created by Yanjunhui

import * as net from 'net';
import { BSONDocument, BSONEncoder, BSONDecoder } from '../bson';
import { MonoError, ErrorCodes } from '../core';
import { Database } from '../engine';
import { WireMessage, MessageHeader, OpCode, nextRequestId } from './wireMessage';
import { OpMsgParser, OpMsgMessage, DocumentSequence } from './opMsg';
import { OpQueryParser, OpReplyBuilder } from './opQuery';
import { DataEndian } from '../storage/dataEndian';
import { Logger } from '../core/logger';

/**
 * MongoDB Wire 协议服务器
 * // EN: Protocol server for MongoDB Wire Protocol
 */
export class ProtocolServer {
    /** 监听地址 // EN: Listen address */
    private addr: string;
    /** 数据库实例 // EN: Database instance */
    private db: Database;
    /** TCP 服务器 // EN: TCP server */
    private server: net.Server | null = null;
    /** 活动连接集合 // EN: Active connections set */
    private connections: Set<net.Socket> = new Set();
    /** 运行状态 // EN: Running state */
    private running: boolean = false;

    constructor(addr: string, db: Database) {
        this.addr = addr;
        this.db = db;
    }

    /**
     * 启动服务器
     * // EN: Start the server
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const [host, portStr] = this.addr.split(':');
            const port = parseInt(portStr, 10);

            this.server = net.createServer((socket) => {
                this.handleConnection(socket);
            });

            this.server.on('error', (err) => {
                Logger.error('Server error', { error: err.message });
                reject(err);
            });

            this.server.listen(port, host, () => {
                this.running = true;
                Logger.info('MonoDB server listening', { addr: this.addr });
                resolve();
            });
        });
    }

    /**
     * 停止服务器
     * // EN: Stop the server
     */
    async stop(): Promise<void> {
        this.running = false;

        // 关闭所有活动连接 // EN: Close all active connections
        for (const socket of this.connections) {
            socket.destroy();
        }
        this.connections.clear();

        // 关闭服务器 // EN: Close server
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    Logger.info('Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * 获取服务器地址
     * // EN: Get server address
     */
    getAddr(): string {
        if (this.server) {
            const addr = this.server.address();
            if (addr && typeof addr === 'object') {
                return `${addr.address}:${addr.port}`;
            }
        }
        return this.addr;
    }

    /**
     * 处理新连接
     * // EN: Handle a new connection
     */
    private handleConnection(socket: net.Socket): void {
        const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
        Logger.info('New connection', { client: clientAddr });

        this.connections.add(socket);

        const handler = new ConnectionHandler(socket, this.db);

        socket.on('close', () => {
            this.connections.delete(socket);
            Logger.info('Connection closed', { client: clientAddr });
        });

        socket.on('error', (err) => {
            if (!err.message.includes('ECONNRESET')) {
                Logger.error('Connection error', { client: clientAddr, error: err.message });
            }
            this.connections.delete(socket);
        });

        handler.run().catch((err) => {
            if (err.message !== 'Connection closed' && !err.message.includes('ECONNRESET')) {
                Logger.error('Handler error', { client: clientAddr, error: err.message });
            }
        });
    }
}

/**
 * 单个客户端连接的处理器
 * // EN: Connection handler for a single client connection
 */
class ConnectionHandler {
    /** 套接字 // EN: Socket */
    private socket: net.Socket;
    /** 数据库实例 // EN: Database instance */
    private db: Database;
    /** 当前数据库名 // EN: Current database name */
    private dbName: string = 'test';
    /** 接收缓冲区 // EN: Receive buffer */
    private buffer: Buffer = Buffer.alloc(0);
    /** BSON 编码器 // EN: BSON encoder */
    private encoder = new BSONEncoder();
    /** BSON 解码器 // EN: BSON decoder */
    private decoder = new BSONDecoder();

    constructor(socket: net.Socket, db: Database) {
        this.socket = socket;
        this.db = db;
    }

    /**
     * 运行连接处理循环
     * // EN: Run the connection handler loop
     */
    async run(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.on('data', async (data: Buffer) => {
                try {
                    await this.handleData(data);
                } catch (err) {
                    if (err instanceof Error) {
                        reject(err);
                    }
                }
            });

            this.socket.on('close', () => {
                resolve();
            });

            this.socket.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * 处理接收的数据
     * // EN: Handle incoming data
     */
    private async handleData(data: Buffer): Promise<void> {
        // 追加到缓冲区 // EN: Append to buffer
        this.buffer = Buffer.concat([this.buffer, data]);

        // 处理完整的消息 // EN: Process complete messages
        while (this.buffer.length >= 4) {
            const messageLength = DataEndian.readInt32LE(this.buffer, 0);

            if (messageLength < 16 || messageLength > 48 * 1024 * 1024) {
                throw MonoError.protocolError(`Invalid message length: ${messageLength}`);
            }

            if (this.buffer.length < messageLength) {
                // 等待更多数据 // EN: Wait for more data
                return;
            }

            // 提取完整消息 // EN: Extract complete message
            const messageBuffer = this.buffer.subarray(0, messageLength);
            this.buffer = this.buffer.subarray(messageLength);

            // 解析并处理消息 // EN: Parse and handle message
            const msg = WireMessage.fromBuffer(messageBuffer);
            const response = await this.handleMessage(msg, messageBuffer);

            if (response) {
                this.socket.write(response.toBuffer());
            }
        }
    }

    /**
     * 处理单条消息
     * // EN: Handle a single message
     */
    private async handleMessage(msg: WireMessage, fullMessage: Buffer): Promise<WireMessage | null> {
        try {
            switch (msg.header.opCode) {
                case OpCode.Msg:
                    return this.handleOpMsg(msg, fullMessage);
                case OpCode.Query:
                    return this.handleOpQuery(msg);
                case OpCode.Compressed:
                    return this.buildErrorResponse(
                        msg.header.requestId,
                        ErrorCodes.ProtocolError,
                        'ProtocolError',
                        'OP_COMPRESSED is not supported. Server does not support compression.'
                    );
                default:
                    return this.buildErrorResponse(
                        msg.header.requestId,
                        ErrorCodes.CommandNotFound,
                        'CommandNotSupported',
                        `Unsupported opcode: ${msg.header.opCode}`
                    );
            }
        } catch (err) {
            Logger.error('Message handling error', { error: err instanceof Error ? err.message : String(err) });
            return this.buildErrorResponse(
                msg.header.requestId,
                ErrorCodes.InternalError,
                'InternalError',
                err instanceof Error ? err.message : 'Unknown error'
            );
        }
    }

    /**
     * 处理 OP_MSG 消息
     * // EN: Handle OP_MSG message
     */
    private async handleOpMsg(msg: WireMessage, fullMessage: Buffer): Promise<WireMessage> {
        const opMsg = OpMsgParser.parse(msg.body, fullMessage);

        if (!opMsg.body) {
            throw MonoError.protocolError('OP_MSG missing body section');
        }

        let cmd = opMsg.body;

        // 附加文档序列用于 insert/update/delete 命令
        // EN: Attach document sequences for insert/update/delete commands
        for (const seq of opMsg.sequences) {
            if (seq.identifier === 'documents') {
                cmd = this.setField(cmd, 'documents', seq.documents);
            } else if (seq.identifier === 'updates') {
                cmd = this.setField(cmd, 'updates', seq.documents);
            } else if (seq.identifier === 'deletes') {
                cmd = this.setField(cmd, 'deletes', seq.documents);
            }
        }

        // 提取数据库名 // EN: Extract database name
        const dbVal = this.getField(cmd, '$db');
        if (typeof dbVal === 'string') {
            this.dbName = dbVal;
        }

        // 执行命令 // EN: Execute command
        let response: BSONDocument;
        try {
            response = await this.db.runCommand(cmd);
        } catch (err) {
            response = this.buildStructuredErrorResponse(err);
        }

        return OpMsgParser.buildReply(msg.header.requestId, response);
    }

    /**
     * 处理 OP_QUERY 消息（遗留协议，主要用于握手）
     * // EN: Handle OP_QUERY message (legacy, mainly for handshake)
     */
    private async handleOpQuery(msg: WireMessage): Promise<WireMessage> {
        const query = OpQueryParser.parse(msg.body);

        // 检查是否是 admin.$cmd 查询（通常是 isMaster/hello）
        // EN: Check if this is an admin.$cmd query (typically isMaster/hello)
        if (query.fullCollectionName.endsWith('.$cmd')) {
            let response: BSONDocument;
            try {
                response = await this.db.runCommand(query.query);
            } catch (err) {
                response = this.buildStructuredErrorResponse(err);
            }
            return OpReplyBuilder.buildReply(msg.header.requestId, [response]);
        }

        // 其他 OP_QUERY 不支持 // EN: Other OP_QUERY not supported
        return OpReplyBuilder.buildReply(msg.header.requestId, [{
            ok: 0,
            errmsg: 'OP_QUERY is deprecated, use OP_MSG',
        }]);
    }

    /**
     * 构建结构化错误响应
     * // EN: Build structured error response
     */
    private buildStructuredErrorResponse(err: unknown): BSONDocument {
        if (err instanceof MonoError) {
            return {
                ok: 0,
                errmsg: err.message,
                code: err.code,
                codeName: err.codeName,
            };
        }

        return {
            ok: 0,
            errmsg: err instanceof Error ? err.message : String(err),
            code: ErrorCodes.InternalError,
            codeName: 'InternalError',
        };
    }

    /**
     * 构建 WireMessage 格式的错误响应
     * // EN: Build error response as WireMessage
     */
    private buildErrorResponse(requestId: number, code: number, codeName: string, message: string): WireMessage {
        const response: BSONDocument = {
            ok: 0,
            errmsg: message,
            code,
            codeName,
        };
        return OpMsgParser.buildReply(requestId, response);
    }

    /**
     * 从 BSON 文档获取字段
     * // EN: Get field from BSON document
     */
    private getField(doc: BSONDocument, key: string): unknown {
        return doc[key];
    }

    /**
     * 在 BSON 文档中设置字段
     * // EN: Set field in BSON document
     */
    private setField(doc: BSONDocument, key: string, value: unknown): BSONDocument {
        return { ...doc, [key]: value as any };
    }
}
