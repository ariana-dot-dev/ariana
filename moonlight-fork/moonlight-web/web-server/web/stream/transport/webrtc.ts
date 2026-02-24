import { StreamSignalingMessage, TransportChannelId } from "../../api_bindings.js";
import { Logger } from "../log.js";
import { allVideoCodecs, CAPABILITIES_CODECS, emptyVideoCodecs, maybeVideoCodecs, VideoCodecSupport } from "../video.js";
import { DataTransportChannel, Transport, TransportAudioSetup, TransportChannel, TransportChannelIdKey, TransportChannelIdValue, TransportVideoSetup, AudioTrackTransportChannel, VideoTrackTransportChannel, TrackTransportChannel, TransportShutdown } from "./index.js";

export class WebRTCTransport implements Transport {
    implementationName: string = "webrtc"

    private logger: Logger | null

    private peer: RTCPeerConnection | null = null
    private t0: number = performance.now()
    private tPlus(): string { return `T+${Math.round(performance.now() - this.t0)}ms` }

    constructor(logger?: Logger) {
        this.logger = logger ?? null
        this.t0 = performance.now()
    }

    async initPeer(configuration?: RTCConfiguration) {
        console.log(`[WebRTC-Browser ${this.tPlus()}] initPeer()`)
        this.logger?.debug(`Creating Client Peer`)

        if (this.peer) {
            this.logger?.debug(`Cannot create Peer because a Peer already exists`)
            return
        }

        // Configure web rtc
        this.peer = new RTCPeerConnection(configuration)
        this.peer.addEventListener("error", this.onError.bind(this))

        this.peer.addEventListener("negotiationneeded", this.onNegotiationNeeded.bind(this))
        this.peer.addEventListener("icecandidate", this.onIceCandidate.bind(this))

        this.peer.addEventListener("connectionstatechange", this.onConnectionStateChange.bind(this))
        this.peer.addEventListener("signalingstatechange", this.onSignalingStateChange.bind(this))
        this.peer.addEventListener("iceconnectionstatechange", this.onIceConnectionStateChange.bind(this))
        this.peer.addEventListener("icegatheringstatechange", this.onIceGatheringStateChange.bind(this))

        this.peer.addEventListener("track", this.onTrack.bind(this))
        this.peer.addEventListener("datachannel", this.onDataChannel.bind(this))

        this.initChannels()

        // Maybe we already received data
        if (this.remoteDescription) {
            await this.handleRemoteDescription(this.remoteDescription)
        } else {
            await this.onNegotiationNeeded()
        }
        await this.tryDequeueIceCandidates()
    }

    private onError(event: Event) {
        this.logger?.debug(`Web Socket or WebRtcPeer Error`)

        console.error(`Web Socket or WebRtcPeer Error`, event)
    }

    onsendmessage: ((message: StreamSignalingMessage) => void) | null = null
    private sendMessage(message: StreamSignalingMessage) {
        if (this.onsendmessage) {
            this.onsendmessage(message)
        } else {
            this.logger?.debug("Failed to call onicecandidate because no handler is set")
        }
    }
    async onReceiveMessage(message: StreamSignalingMessage) {
        if ("Description" in message) {
            const description = message.Description;
            await this.handleRemoteDescription({
                type: description.ty as RTCSdpType,
                sdp: description.sdp
            })
        } else if ("AddIceCandidate" in message) {
            const candidate = message.AddIceCandidate
            await this.addIceCandidate({
                candidate: candidate.candidate,
                sdpMid: candidate.sdp_mid,
                sdpMLineIndex: candidate.sdp_mline_index,
                usernameFragment: candidate.username_fragment
            })
        }
    }

    private async onNegotiationNeeded() {
        // We're polite
        if (!this.peer) {
            this.logger?.debug("OnNegotiationNeeded without a peer")
            return
        }

        await this.peer.setLocalDescription()
        const localDescription = this.peer.localDescription
        if (!localDescription) {
            this.logger?.debug("Failed to set local description in OnNegotiationNeeded")
            return
        }

        this.logger?.debug(`OnNegotiationNeeded: Sending local description: ${localDescription.type}`)
        this.sendMessage({
            Description: {
                ty: localDescription.type,
                sdp: localDescription.sdp ?? ""
            }
        })
    }

    // webrtc-rs regenerates ICE credentials on every renegotiation offer (answerer→offerer
    // role switch). This triggers an ICE restart on the browser side. Previously we tried to
    // patch the SDP to preserve original credentials, but this caused a credential mismatch:
    // the server's ICE agent uses the NEW credentials for STUN regardless of the SDP, so
    // Chrome's consent freshness check failed after ~5s and killed the connection.
    //
    // The correct fix: let the ICE restart happen naturally. Chrome will re-gather candidates
    // and reconnect using the new credentials. Since NAT mappings are still fresh, this
    // recovers in ~200ms with a brief visual hiccup at most.

    private remoteDescription: RTCSessionDescriptionInit | null = null
    private async handleRemoteDescription(sdp: RTCSessionDescriptionInit | null) {
        console.log(`[WebRTC-Browser ${this.tPlus()}] handleRemoteDescription type=${sdp?.type}`)
        this.logger?.debug(`Received remote description: ${sdp?.type}`)

        const remoteDescription = sdp
        this.remoteDescription = remoteDescription
        if (!this.peer) {
            return
        }
        this.remoteDescription = null

        if (remoteDescription) {
            this.logger?.debug(`[handleRemoteDescription] type=${remoteDescription.type} ICE=${this.peer.iceConnectionState} signaling=${this.peer.signalingState}`)

            await this.peer.setRemoteDescription(remoteDescription)

            this.logger?.debug(`[handleRemoteDescription] after setRemoteDescription: ICE=${this.peer.iceConnectionState} conn=${this.peer.connectionState} signaling=${this.peer.signalingState}`)

            if (remoteDescription.type == "offer") {
                if (this.wasConnected) {
                    // Server renegotiation (adding video/audio tracks). webrtc-rs sends new ICE
                    // credentials which triggers an ICE restart in the browser. This is expected
                    // and recovers quickly since NAT mappings are still fresh.
                    console.log(`[WebRTC-Browser ${this.tPlus()}] Server renegotiation offer (ICE restart expected, will recover)`)
                    this.logger?.debug("Server renegotiation offer received while connected")
                }
                await this.peer.setLocalDescription()
                const localDescription = this.peer.localDescription
                if (!localDescription) {
                    this.logger?.debug("Peer didn't have a localDescription whilst receiving an offer and trying to answer")
                    return
                }

                this.logger?.debug(`[handleRemoteDescription] sending answer, ICE=${this.peer.iceConnectionState} signaling=${this.peer.signalingState}`)
                this.sendMessage({
                    Description: {
                        ty: localDescription.type,
                        sdp: localDescription.sdp ?? ""
                    }
                })
            }
        }
    }

    private onIceCandidate(event: RTCPeerConnectionIceEvent) {
        if (event.candidate) {
            const candidate = event.candidate.toJSON()
            this.logger?.debug(`Sending ice candidate: ${candidate.candidate}`)

            this.sendMessage({
                AddIceCandidate: {
                    candidate: candidate.candidate ?? "",
                    sdp_mid: candidate.sdpMid ?? null,
                    sdp_mline_index: candidate.sdpMLineIndex ?? null,
                    username_fragment: candidate.usernameFragment ?? null
                }
            })
        } else {
            this.logger?.debug("No new ice candidates")
        }
    }

    private iceCandidates: Array<RTCIceCandidateInit> = []
    private async addIceCandidate(candidate: RTCIceCandidateInit) {
        this.logger?.debug(`Received ice candidate: ${candidate.candidate}`)

        if (!this.peer) {
            this.logger?.debug("Buffering ice candidate")

            this.iceCandidates.push(candidate)
            return
        }
        await this.tryDequeueIceCandidates()

        await this.peer.addIceCandidate(candidate)
    }
    private async tryDequeueIceCandidates() {
        if (!this.peer) {
            this.logger?.debug("called tryDequeueIceCandidates without a peer")
            return
        }

        for (const candidate of this.iceCandidates) {
            await this.peer.addIceCandidate(candidate)
        }
        this.iceCandidates.length = 0
    }

    private wasConnected = false
    private closeFired = false // Guard: onclose must fire at most once per peer
    private dataChannelCheckTimeout: ReturnType<typeof setTimeout> | null = null
    private disconnectRecoveryTimer: ReturnType<typeof setTimeout> | null = null
    dataChannelsFailed = false
    needsFullReconnection = false

    private fireOnclose(reason: TransportShutdown) {
        if (this.closeFired) return
        this.closeFired = true
        if (this.onclose) {
            this.onclose(reason)
        }
    }

    private onConnectionStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnConnectionStateChange without a peer")
            return
        }

        let type: null | "fatal" | "recover" = null

        if (this.peer.connectionState == "connected") {
            console.log(`[WebRTC-Browser ${this.tPlus()}] connectionState=connected (wasConnected=${this.wasConnected})`)
            type = "recover"

            // Clear disconnect recovery timer if pending
            if (this.disconnectRecoveryTimer) {
                clearTimeout(this.disconnectRecoveryTimer)
                this.disconnectRecoveryTimer = null
            }

            if (!this.wasConnected) {
                // First connection: gate on data channels being open before signaling ready.
                // Data channels need DCEP negotiation AFTER ICE/DTLS, so they may not be
                // open when connectionState hits "connected". Without this gate, the stream
                // starts (video appears) but cursor is frozen because mouse data channels
                // aren't ready yet.
                this.wasConnected = true
                this.waitForDataChannels()
            } else {
                // Reconnection - channels survive ICE restart
                if (this.onconnect) {
                    this.onconnect()
                }
            }
        } else if (this.peer.connectionState == "failed") {
            // Connection completely failed - ICE exhausted all candidates. Trigger full reconnect
            // to create a new peer connection with fresh negotiation.
            console.log(`[WebRTC-Browser ${this.tPlus()}] connectionState=failed (wasConnected=${this.wasConnected}) → full reconnect`)
            type = "fatal"
            this.needsFullReconnection = this.wasConnected
            this.fireOnclose("failed")
        } else if (this.peer.connectionState == "disconnected") {
            // "disconnected" is a transient state - ICE/TURN recovery can bring it back.
            // The server-side has 30s disconnected timeout and 60s failed timeout.
            // Under high latency or brief network blips, immediately closing here causes
            // unnecessary reconnection loops. Give ICE recovery 25s (just under server's 30s)
            // to avoid triggering a full reconnect when ICE restart would have succeeded.
            // With the credential fix in place, ICE restarts now work correctly and can
            // recover the connection on bad internet without rebuilding the entire pipeline.
            console.log(`[WebRTC-Browser ${this.tPlus()}] connectionState=disconnected (wasConnected=${this.wasConnected}) → waiting for ICE recovery`)
            if (this.wasConnected && !this.disconnectRecoveryTimer) {
                this.disconnectRecoveryTimer = setTimeout(() => {
                    this.disconnectRecoveryTimer = null
                    if (this.peer?.connectionState === "disconnected") {
                        console.log(`[WebRTC-Browser ${this.tPlus()}] ICE recovery timeout after 25s, closing`)
                        this.needsFullReconnection = true
                        this.fireOnclose("failed")
                    }
                }, 25000)
            } else if (!this.wasConnected) {
                // Never connected at all - don't wait
                type = "fatal"
                this.fireOnclose("failednoconnect")
            }
        } else if (this.peer.connectionState == "closed") {
            type = "fatal"
            if (this.wasConnected) {
                this.fireOnclose("failed")
            } else {
                this.fireOnclose("failednoconnect")
            }
        }

        this.logger?.debug(`Changing Peer State to ${this.peer.connectionState}`, {
            type: type ?? undefined
        })
    }

    // Polls until mouse data channels are open, then signals onconnect.
    // If they don't open within timeout, sets dataChannelsFailed and closes peer for retry.
    // 15s timeout: DCEP negotiation over high-latency connections (train WiFi,
    // intercontinental) can exceed the previous 5s limit.
    private waitForDataChannels() {
        const MAX_WAIT = 15000
        const CHECK_INTERVAL = 200
        const start = Date.now()

        let checkCount = 0
        const check = () => {
            this.dataChannelCheckTimeout = null
            checkCount++

            if (!this.peer || this.peer.connectionState !== "connected") {
                this.logger?.debug(`[waitForDataChannels] check #${checkCount}: aborting - peer=${this.peer ? 'exists' : 'null'} connectionState=${this.peer?.connectionState ?? 'N/A'}`)
                return
            }

            const mouseRelative = this.channels[TransportChannelId.MOUSE_RELATIVE]
            const mouseAbsolute = this.channels[TransportChannelId.MOUSE_ABSOLUTE]
            const relChannel = mouseRelative?.type === "data" ? (mouseRelative as WebRTCDataTransportChannel) : null
            const absChannel = mouseAbsolute?.type === "data" ? (mouseAbsolute as WebRTCDataTransportChannel) : null
            const relOpen = relChannel?.isOpen ?? false
            const absOpen = absChannel?.isOpen ?? false

            const elapsed = Date.now() - start
            this.logger?.debug(`[waitForDataChannels] check #${checkCount} (${elapsed}ms): relative={type=${mouseRelative?.type ?? 'null'}, open=${relOpen}, buffered=${relChannel?.estimatedBufferedBytes() ?? 'N/A'}} absolute={type=${mouseAbsolute?.type ?? 'null'}, open=${absOpen}, buffered=${absChannel?.estimatedBufferedBytes() ?? 'N/A'}} ICE=${this.peer.iceConnectionState}`)

            if (relOpen && absOpen) {
                console.log(`[WebRTC-Browser ${this.tPlus()}] Data channels ready (${elapsed}ms wait, ${checkCount} checks)`)
                this.logger?.debug(`[waitForDataChannels] both channels open after ${elapsed}ms and ${checkCount} checks, signaling transport ready`)
                if (this.onconnect) {
                    this.onconnect()
                }
                return
            }

            if (elapsed >= MAX_WAIT) {
                this.logger?.debug(`[waitForDataChannels] TIMEOUT after ${MAX_WAIT}ms and ${checkCount} checks (relative: ${relOpen}, absolute: ${absOpen}), closing for retry`)
                this.dataChannelsFailed = true
                this.peer?.close()
                return
            }

            this.dataChannelCheckTimeout = setTimeout(check, CHECK_INTERVAL)
        }

        check()
    }

    private onSignalingStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnSignalingStateChange without a peer")
            return
        }
        this.logger?.debug(`Changing Peer Signaling State to ${this.peer.signalingState}`)
    }
    private onIceConnectionStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnIceConnectionStateChange without a peer")
            return
        }
        this.logger?.debug(`Changing Peer Ice State to ${this.peer.iceConnectionState}`)
    }
    private onIceGatheringStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnIceGatheringStateChange without a peer")
            return
        }
        this.logger?.debug(`Changing Peer Ice Gathering State to ${this.peer.iceGatheringState}`)

        if (this.peer.iceConnectionState == "new" && this.peer.iceGatheringState == "complete") {
            // we failed without connection
            this.fireOnclose("failednoconnect")
        }
    }

    private channels: Array<TransportChannel | null> = []
    private initChannels() {
        if (!this.peer) {
            this.logger?.debug("Failed to initialize channel without peer")
            return
        }
        if (this.channels.length > 0) {
            this.logger?.debug("Already initialized channels")
            return
        }

        // WebRTC channels:
        // - Video/Audio media tracks (RTP)
        // - Mouse movement data channels (unreliable, low latency like video)
        // Other input (keyboard, clicks, gamepad, touch) goes over WebSocket for reliability.

        const videoChannel: VideoTrackTransportChannel = new WebRTCInboundTrackTransportChannel<"videotrack">(this.logger, "videotrack", "video", this.videoTrackHolder)
        this.channels[TransportChannelId.HOST_VIDEO] = videoChannel

        const audioChannel: AudioTrackTransportChannel = new WebRTCInboundTrackTransportChannel<"audiotrack">(this.logger, "audiotrack", "audio", this.audioTrackHolder)
        this.channels[TransportChannelId.HOST_AUDIO] = audioChannel

        // Mouse movement data channels - unreliable, low latency (like video)
        const mouseRelativeDc = this.peer.createDataChannel("mouse_relative", {
            ordered: false,
            maxRetransmits: 0
        })
        this.channels[TransportChannelId.MOUSE_RELATIVE] = new WebRTCDataTransportChannel("MOUSE_RELATIVE", mouseRelativeDc)

        const mouseAbsoluteDc = this.peer.createDataChannel("mouse_absolute", {
            ordered: false,
            maxRetransmits: 0
        })
        this.channels[TransportChannelId.MOUSE_ABSOLUTE] = new WebRTCDataTransportChannel("MOUSE_ABSOLUTE", mouseAbsoluteDc)
    }

    private videoTrackHolder: TrackHolder = { ontrack: null, track: null }
    private videoReceiver: RTCRtpReceiver | null = null

    private audioTrackHolder: TrackHolder = { ontrack: null, track: null }

    private onTrack(event: RTCTrackEvent) {
        const track = event.track

        if (track.kind == "video") {
            this.videoReceiver = event.receiver
        }

        console.log(`[WebRTC-Browser ${this.tPlus()}] onTrack: ${track.kind}`)
        this.logger?.debug(`Adding receiver: ${track.kind}, ${track.id}, ${track.label}`)

        if (track.kind == "video") {
            if ("contentHint" in track) {
                track.contentHint = "motion"
            }

            this.videoTrackHolder.track = track
            if (!this.videoTrackHolder.ontrack) {
                throw "No video track listener registered!"
            }
            this.videoTrackHolder.ontrack()
        } else if (track.kind == "audio") {
            this.audioTrackHolder.track = track
            if (!this.audioTrackHolder.ontrack) {
                throw "No audio track listener registered!"
            }
            this.audioTrackHolder.ontrack()
        }
    }

    // Handle data channels created by the remote peer (server)
    private onDataChannel(event: RTCDataChannelEvent) {
        const remoteChannel = event.channel
        const label = remoteChannel.label

        this.logger?.debug(`Received remote data channel: ${label}`)

        // Map the channel label to the corresponding TransportChannelId
        const channelKey = label.toUpperCase() as TransportChannelIdKey
        if (channelKey in TransportChannelId) {
            const id = TransportChannelId[channelKey]
            const existingChannel = this.channels[id]

            // If we already have a channel for this ID, replace its underlying RTCDataChannel
            // with the remote one so we can receive messages from the server
            if (existingChannel && existingChannel.type === "data") {
                this.logger?.debug(`Replacing underlying channel for ${label} with remote channel`);
                (existingChannel as WebRTCDataTransportChannel).replaceChannel(remoteChannel)
            } else {
                this.logger?.debug(`Creating new channel for ${label}`)
                this.channels[id] = new WebRTCDataTransportChannel(label, remoteChannel)
            }
        } else {
            this.logger?.debug(`Unknown remote data channel: ${label}`)
        }
    }

    async setupHostVideo(_setup: TransportVideoSetup): Promise<VideoCodecSupport> {
        // TODO: check transport type

        let capabilities
        if ("getCapabilities" in RTCRtpReceiver && (capabilities = RTCRtpReceiver.getCapabilities("video"))) {
            const codecs = emptyVideoCodecs()

            for (const codec in codecs) {
                const supportRequirements = CAPABILITIES_CODECS[codec]

                if (!supportRequirements) {
                    continue
                }

                let supported = false
                capabilityCodecLoop: for (const codecCapability of capabilities.codecs) {
                    if (codecCapability.mimeType != supportRequirements.mimeType) {
                        continue
                    }

                    for (const fmtpLine of supportRequirements.fmtpLine) {
                        if (!codecCapability.sdpFmtpLine?.includes(fmtpLine)) {
                            continue capabilityCodecLoop
                        }
                    }

                    supported = true
                    break
                }

                codecs[codec] = supported
            }

            return codecs
        } else {
            return maybeVideoCodecs()
        }
    }

    async setupHostAudio(_setup: TransportAudioSetup): Promise<void> {
        // TODO: check transport type
    }

    getChannel(id: TransportChannelIdValue): TransportChannel {
        const channel = this.channels[id]
        if (!channel) {
            this.logger?.debug("Failed to setup video without peer")
            throw `Failed to get channel because it is not yet initialized, Id: ${id}`
        }

        return channel
    }

    onconnect: (() => void) | null = null

    onclose: ((shutdown: TransportShutdown) => void) | null = null
    async close(): Promise<void> {
        this.logger?.debug("Closing WebRTC Peer")

        if (this.dataChannelCheckTimeout) {
            clearTimeout(this.dataChannelCheckTimeout)
            this.dataChannelCheckTimeout = null
        }
        if (this.disconnectRecoveryTimer) {
            clearTimeout(this.disconnectRecoveryTimer)
            this.disconnectRecoveryTimer = null
        }
        this.peer?.close()
    }

    async getStats(): Promise<Record<string, string>> {
        const statsData: Record<string, string> = {}

        if (!this.videoReceiver) {
            return {}
        }
        const stats = await this.videoReceiver.getStats()

        console.debug("----------------- raw video stats -----------------")
        for (const [key, value] of stats.entries()) {
            console.debug("raw video stats", key, value)

            if ("decoderImplementation" in value && value.decoderImplementation != null) {
                statsData.decoderImplementation = value.decoderImplementation
            }
            if ("frameWidth" in value && value.frameWidth != null) {
                statsData.videoWidth = value.frameWidth
            }
            if ("frameHeight" in value && value.frameHeight != null) {
                statsData.videoHeight = value.frameHeight
            }
            if ("framesPerSecond" in value && value.framesPerSecond != null) {
                statsData.webrtcFps = value.framesPerSecond
            }

            if ("jitterBufferDelay" in value && value.jitterBufferDelay != null) {
                statsData.webrtcJitterBufferDelayMs = value.jitterBufferDelay
            }
            if ("jitterBufferTargetDelay" in value && value.jitterBufferTargetDelay != null) {
                statsData.webrtcJitterBufferTargetDelayMs = value.jitterBufferTargetDelay
            }
            if ("jitterBufferMinimumDelay" in value && value.jitterBufferMinimumDelay != null) {
                statsData.webrtcJitterBufferMinimumDelayMs = value.jitterBufferMinimumDelay
            }
            if ("jitter" in value && value.jitter != null) {
                statsData.webrtcJitterMs = value.jitter
            }
            if ("totalDecodeTime" in value && value.totalDecodeTime != null) {
                statsData.webrtcTotalDecodeTimeMs = value.totalDecodeTime
            }
            if ("totalAssemblyTime" in value && value.totalAssemblyTime != null) {
                statsData.webrtcTotalAssemblyTimeMs = value.totalAssemblyTime
            }
            if ("totalProcessingDelay" in value && value.totalProcessingDelay != null) {
                statsData.webrtcTotalProcessingDelayMs = value.totalProcessingDelay
            }
            if ("packetsReceived" in value && value.packetsReceived != null) {
                statsData.webrtcPacketsReceived = value.packetsReceived
            }
            if ("packetsLost" in value && value.packetsLost != null) {
                statsData.webrtcPacketsLost = value.packetsLost
            }
            if ("framesDropped" in value && value.framesDropped != null) {
                statsData.webrtcFramesDropped = value.framesDropped
            }
            if ("keyFramesDecoded" in value && value.keyFramesDecoded != null) {
                statsData.webrtcKeyFramesDecoded = value.keyFramesDecoded
            }
            if ("nackCount" in value && value.nackCount != null) {
                statsData.webrtcNackCount = value.nackCount
            }
        }

        return statsData
    }
}

type TrackHolder = {
    ontrack: (() => void) | null
    track: MediaStreamTrack | null
}

// This receives track data
class WebRTCInboundTrackTransportChannel<T extends string> implements TrackTransportChannel {
    type: T

    canReceive: boolean = true
    canSend: boolean = false

    private logger: Logger | null

    private label: string
    private trackHolder: TrackHolder

    constructor(logger: Logger | null, type: T, label: string, trackHolder: TrackHolder) {
        this.logger = logger

        this.type = type
        this.label = label
        this.trackHolder = trackHolder

        this.trackHolder.ontrack = this.onTrack.bind(this)
    }
    setTrack(_track: MediaStreamTrack | null): void {
        throw "WebRTCInboundTrackTransportChannel cannot addTrack"
    }

    private onTrack() {
        const track = this.trackHolder.track
        if (!track) {
            this.logger?.debug("WebRTC TrackHolder.track is null!")
            return
        }

        for (const listener of this.trackListeners) {
            listener(track)
        }
    }


    private trackListeners: Array<(track: MediaStreamTrack) => void> = []
    addTrackListener(listener: (track: MediaStreamTrack) => void): void {
        if (this.trackHolder.track) {
            listener(this.trackHolder.track)
        }
        this.trackListeners.push(listener)
    }
    removeTrackListener(listener: (track: MediaStreamTrack) => void): void {
        const index = this.trackListeners.indexOf(listener)
        if (index != -1) {
            this.trackListeners.splice(index, 1)
        }
    }
}

class WebRTCDataTransportChannel implements DataTransportChannel {
    type: "data" = "data"

    canReceive: boolean = true
    canSend: boolean = true

    private label: string
    private channel: RTCDataChannel
    private boundOnMessage: (event: MessageEvent) => void
    private boundOnOpen: () => void

    constructor(label: string, channel: RTCDataChannel) {
        this.label = label
        this.channel = channel
        this.boundOnMessage = this.onMessage.bind(this)
        this.boundOnOpen = this.onOpen.bind(this)

        this.channel.addEventListener("message", this.boundOnMessage)
        this.channel.addEventListener("open", this.boundOnOpen)
    }

    get isOpen(): boolean {
        return this.channel.readyState === "open"
    }

    private onOpen(): void {
        this.tryDequeueSendQueue()
    }

    // Replace the underlying channel with a new one (e.g., from remote peer)
    // This is used when we receive a data channel from the server that should
    // replace our locally created one for receiving messages
    replaceChannel(newChannel: RTCDataChannel): void {
        // Remove listeners from old channel
        this.channel.removeEventListener("message", this.boundOnMessage)
        this.channel.removeEventListener("open", this.boundOnOpen)
        // Add listeners to new channel
        this.channel = newChannel
        this.channel.addEventListener("message", this.boundOnMessage)
        this.channel.addEventListener("open", this.boundOnOpen)
    }

    private sendQueue: Array<ArrayBuffer> = []
    send(message: ArrayBuffer): void {
        if (this.channel.readyState != "open") {
            console.debug(`Tried sending packet to ${this.label} with readyState ${this.channel.readyState}. Buffering it for the future.`)
            this.sendQueue.push(message)
        } else {
            this.tryDequeueSendQueue()
            this.channel.send(message)
        }
    }
    private tryDequeueSendQueue() {
        for (const message of this.sendQueue) {
            this.channel.send(message)
        }
        this.sendQueue.length = 0
    }

    private onMessage(event: MessageEvent) {
        const data = event.data
        if (!(data instanceof ArrayBuffer)) {
            console.warn(`received text data on webrtc channel ${this.label}`)
            return
        }

        for (const listener of this.receiveListeners) {
            listener(event.data)
        }
    }
    private receiveListeners: Array<(data: ArrayBuffer) => void> = []
    addReceiveListener(listener: (data: ArrayBuffer) => void): void {
        this.receiveListeners.push(listener)
    }
    removeReceiveListener(listener: (data: ArrayBuffer) => void): void {
        const index = this.receiveListeners.indexOf(listener)
        if (index != -1) {
            this.receiveListeners.splice(index, 1)
        }
    }
    estimatedBufferedBytes(): number {
        return this.channel.bufferedAmount
    }
}