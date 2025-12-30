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
 * Protocol server for MongoDB Wire Protocol
 */
export class ProtocolServer {
    private addr: string;
    private db: Database;
    private server: net.Server | null = null;
    private connections: Set<net.Socket> = new Set();
    private running: boolean = false;

    constructor(addr: string, db: Database) {
        this.addr = addr;
        this.db = db;
    }

    /**
     * Start the server
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
     * Stop the server
     */
    async stop(): Promise<void> {
        this.running = false;

        // Close all active connections
        for (const socket of this.connections) {
            socket.destroy();
        }
        this.connections.clear();

        // Close server
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
     * Get server address
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
     * Handle a new connection
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
 * Connection handler for a single client connection
 */
class ConnectionHandler {
    private socket: net.Socket;
    private db: Database;
    private dbName: string = 'test';
    private buffer: Buffer = Buffer.alloc(0);
    private encoder = new BSONEncoder();
    private decoder = new BSONDecoder();

    constructor(socket: net.Socket, db: Database) {
        this.socket = socket;
        this.db = db;
    }

    /**
     * Run the connection handler loop
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
     * Handle incoming data
     */
    private async handleData(data: Buffer): Promise<void> {
        // Append to buffer
        this.buffer = Buffer.concat([this.buffer, data]);

        // Process complete messages
        while (this.buffer.length >= 4) {
            const messageLength = DataEndian.readInt32LE(this.buffer, 0);

            if (messageLength < 16 || messageLength > 48 * 1024 * 1024) {
                throw MonoError.protocolError(`Invalid message length: ${messageLength}`);
            }

            if (this.buffer.length < messageLength) {
                // Wait for more data
                return;
            }

            // Extract complete message
            const messageBuffer = this.buffer.subarray(0, messageLength);
            this.buffer = this.buffer.subarray(messageLength);

            // Parse and handle message
            const msg = WireMessage.fromBuffer(messageBuffer);
            const response = await this.handleMessage(msg, messageBuffer);

            if (response) {
                this.socket.write(response.toBuffer());
            }
        }
    }

    /**
     * Handle a single message
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
     * Handle OP_MSG message
     */
    private async handleOpMsg(msg: WireMessage, fullMessage: Buffer): Promise<WireMessage> {
        const opMsg = OpMsgParser.parse(msg.body, fullMessage);

        if (!opMsg.body) {
            throw MonoError.protocolError('OP_MSG missing body section');
        }

        let cmd = opMsg.body;

        // Attach document sequences for insert/update/delete commands
        for (const seq of opMsg.sequences) {
            if (seq.identifier === 'documents') {
                cmd = this.setField(cmd, 'documents', seq.documents);
            } else if (seq.identifier === 'updates') {
                cmd = this.setField(cmd, 'updates', seq.documents);
            } else if (seq.identifier === 'deletes') {
                cmd = this.setField(cmd, 'deletes', seq.documents);
            }
        }

        // Extract database name
        const dbVal = this.getField(cmd, '$db');
        if (typeof dbVal === 'string') {
            this.dbName = dbVal;
        }

        // Execute command
        let response: BSONDocument;
        try {
            response = await this.db.runCommand(cmd);
        } catch (err) {
            response = this.buildStructuredErrorResponse(err);
        }

        return OpMsgParser.buildReply(msg.header.requestId, response);
    }

    /**
     * Handle OP_QUERY message (legacy, mainly for handshake)
     */
    private async handleOpQuery(msg: WireMessage): Promise<WireMessage> {
        const query = OpQueryParser.parse(msg.body);

        // Check if this is an admin.$cmd query (typically isMaster/hello)
        if (query.fullCollectionName.endsWith('.$cmd')) {
            let response: BSONDocument;
            try {
                response = await this.db.runCommand(query.query);
            } catch (err) {
                response = this.buildStructuredErrorResponse(err);
            }
            return OpReplyBuilder.buildReply(msg.header.requestId, [response]);
        }

        // Other OP_QUERY not supported
        return OpReplyBuilder.buildReply(msg.header.requestId, [{
            ok: 0,
            errmsg: 'OP_QUERY is deprecated, use OP_MSG',
        }]);
    }

    /**
     * Build structured error response
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
     * Build error response as WireMessage
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
     * Get field from BSON document
     */
    private getField(doc: BSONDocument, key: string): unknown {
        return doc[key];
    }

    /**
     * Set field in BSON document
     */
    private setField(doc: BSONDocument, key: string, value: unknown): BSONDocument {
        return { ...doc, [key]: value as any };
    }
}
