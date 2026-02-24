import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TerminalConnection {
    id: string;
    onData?: (data: string) => void;
    onDisconnect?: () => void;
}

class TerminalServiceImpl {
    private connections: Map<string, TerminalConnection> = new Map();
    private listeners: Map<string, () => void> = new Map();
    private terminalConnections: Map<string, string> = new Map(); // terminal element ID -> connection ID
    private pendingConnections: Map<string, Promise<string>> = new Map(); // terminal element ID -> in-flight promise
    private lastSentTime: Map<string, number> = new Map(); // key -> timestamp for debouncing

    async createConnection(
        terminalElementId?: string,
    ): Promise<string> {
        try {
            // ----- Handle duplicate / in-flight requests -----
            if (terminalElementId) {
                // Reuse existing finished connection
                if (this.terminalConnections.has(terminalElementId)) {
                    const existingConnectionId =
                        this.terminalConnections.get(terminalElementId)!;
                    console.log(
                        `Terminal ${terminalElementId} already has connection ${existingConnectionId}, reusing`,
                    );
                    return existingConnectionId;
                }
                // Await any in-flight promise
                if (this.pendingConnections.has(terminalElementId)) {
                    console.log(
                        `Terminal ${terminalElementId} connection is still pending, awaiting…`,
                    );
                    return this.pendingConnections.get(terminalElementId)!;
                }
            }

            // Actually create the connection (and track promise early to avoid a race)
            const creationPromise = (async () => {
                const connectionId = await invoke<string>(
                    "create_terminal_connection",
                    { },
                );

                const connection: TerminalConnection = {
                    id: connectionId,
                };
                this.connections.set(connectionId, connection);

                // Map terminal element ID to connection ID
                if (terminalElementId) {
                    this.terminalConnections.set(terminalElementId, connectionId);
                }

                // Set up event listeners exactly once
                await this.setupEventListeners(connectionId);

                return connectionId;
            })();

            if (terminalElementId) {
                this.pendingConnections.set(terminalElementId, creationPromise);
            }

            const connectionId = await creationPromise;

            if (terminalElementId) {
                // connection resolved — no longer pending
                this.pendingConnections.delete(terminalElementId);
            }

            return connectionId;
        } catch (error) {
            console.error("Failed to create terminal connection:", error);
            if (terminalElementId) {
                this.pendingConnections.delete(terminalElementId);
            }
            throw error;
        }
    }

    async closeConnection(connectionId: string): Promise<void> {
        try {
            await invoke("close_terminal_connection", { connectionId });

            // Clean up listeners
            const unlistenFn = this.listeners.get(connectionId);
            if (unlistenFn) {
                unlistenFn();
                this.listeners.delete(connectionId);
            }

            // Remove from terminal connections map
            for (const [terminalId, connId] of this.terminalConnections) {
                if (connId === connectionId) {
                    this.terminalConnections.delete(terminalId);
                    break;
                }
            }

            this.connections.delete(connectionId);
        } catch (error) {
            console.error("Failed to close terminal connection:", error);
        }
    }

    async sendData(connectionId: string, data: string): Promise<void> {
        try {
            // Prevent rapid duplicate sends
            const key = `${connectionId}-${data}`;
            const now = Date.now();
            const lastSent = this.lastSentTime.get(key) || 0;

            if (now - lastSent < 50) {
                // 50ms debounce
                console.log(
                    `Debouncing duplicate send for ${connectionId}: ${JSON.stringify(data)}`,
                );
                return;
            }

            this.lastSentTime.set(key, now);
            await invoke("send_terminal_data", { connectionId, data });
        } catch (error) {
            console.error("Failed to send terminal data:", error);
        }
    }

    async resizeTerminal(
        connectionId: string,
        cols: number,
        rows: number,
    ): Promise<void> {
        try {
            await invoke("resize_terminal", { connectionId, cols, rows });
        } catch (error) {
            console.error("Failed to resize terminal:", error);
        }
    }

    onData(connectionId: string, callback: (data: string) => void): void {
        const connection = this.connections.get(connectionId);
        if (connection) {
            connection.onData = callback;
        }
    }

    onDisconnect(connectionId: string, callback: () => void): void {
        const connection = this.connections.get(connectionId);
        if (connection) {
            connection.onDisconnect = callback;
        }
    }

    private async setupEventListeners(connectionId: string): Promise<void> {
        // Listen for terminal data events
        const unlistenData = await listen(
            `terminal-data-${connectionId}`,
            (event) => {
                const connection = this.connections.get(connectionId);
                if (connection && connection.onData) {
                    connection.onData(event.payload as string);
                }
            },
        );

        // Listen for terminal disconnect events
        const unlistenDisconnect = await listen(
            `terminal-disconnect-${connectionId}`,
            () => {
                const connection = this.connections.get(connectionId);
                if (connection && connection.onDisconnect) {
                    connection.onDisconnect();
                }
            },
        );

        // Store unlisten functions
        this.listeners.set(connectionId, () => {
            unlistenData();
            unlistenDisconnect();
        });
    }

    async cleanupDeadConnections(): Promise<void> {
        try {
            await invoke("cleanup_dead_connections");
        } catch (error) {
            console.error("Failed to cleanup dead connections:", error);
        }
    }

    async closeConnectionByTerminalId(terminalElementId: string): Promise<void> {
        const connectionId = this.terminalConnections.get(terminalElementId);
        if (connectionId) {
            await this.closeConnection(connectionId);
        }
    }
}

export const TerminalService = new TerminalServiceImpl();