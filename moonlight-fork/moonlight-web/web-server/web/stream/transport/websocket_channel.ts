import { encrypt, decrypt } from "../crypto.js"
import { DataTransportChannel } from "./index.js"

// Multiplexes multiple logical channels over one encrypted WebSocket.
// Each message is: encrypt([channelId:u8][payload])
// The server demuxes by channelId and routes to the right handler.
export class WebSocketDataChannel implements DataTransportChannel {
    type: "data" = "data"

    canReceive: boolean = true
    canSend: boolean = true

    private ws: WebSocket
    private channelId: number

    constructor(ws: WebSocket, channelId: number) {
        this.ws = ws
        this.channelId = channelId
    }

    send(message: ArrayBuffer): void {
        if (this.ws.readyState !== WebSocket.OPEN) {
            console.debug(`[WS-Channel ${this.channelId}] WebSocket not open, dropping packet`)
            return
        }

        // Prepend channelId byte to payload, then encrypt and send
        const payload = new Uint8Array(1 + message.byteLength)
        payload[0] = this.channelId
        payload.set(new Uint8Array(message), 1)

        encrypt(payload).then((encrypted) => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(encrypted)
            }
        }).catch((err) => {
            console.warn(`[WS-Channel ${this.channelId}] Encrypt failed, dropping packet:`, err)
        })
    }

    // Called by Stream.onRawWsMessage when it receives binary data
    // and demuxes to this channel by channelId
    handleIncoming(data: Uint8Array): void {
        for (const listener of this.receiveListeners) {
            listener(data.buffer)
        }
    }

    private receiveListeners: Array<(data: ArrayBuffer) => void> = []
    addReceiveListener(listener: (data: ArrayBuffer) => void): void {
        this.receiveListeners.push(listener)
    }
    removeReceiveListener(listener: (data: ArrayBuffer) => void): void {
        const index = this.receiveListeners.indexOf(listener)
        if (index !== -1) {
            this.receiveListeners.splice(index, 1)
        }
    }

    estimatedBufferedBytes(): number {
        return this.ws.bufferedAmount
    }
}

// Demuxes incoming encrypted binary WebSocket messages and routes
// them to the correct WebSocketDataChannel by channelId.
export class WebSocketChannelMux {
    private channels: Map<number, WebSocketDataChannel> = new Map()

    register(channelId: number, channel: WebSocketDataChannel): void {
        this.channels.set(channelId, channel)
    }

    // Call this with decrypted payload (after stripping nonce/tag)
    async handleMessage(rawEncrypted: Uint8Array): Promise<void> {
        const decrypted = await decrypt(rawEncrypted)
        if (decrypted.length < 1) {
            console.warn("[WS-Mux] Empty decrypted message")
            return
        }

        const channelId = decrypted[0]
        const payload = decrypted.slice(1)

        const channel = this.channels.get(channelId)
        if (!channel) {
            console.warn(`[WS-Mux] No channel registered for id ${channelId}`)
            return
        }

        channel.handleIncoming(payload)
    }
}
