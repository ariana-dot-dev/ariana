import { Api } from "../api.js"
import { App, ConnectionStatus, GeneralServerMessage, StreamCapabilities, StreamClientMessage, StreamServerMessage, TransportChannelId } from "../api_bindings.js"
import { showErrorPopup } from "../component/error.js"
import { Component } from "../component/index.js"
import { Settings } from "../component/settings_menu.js"
import { AudioPlayer } from "./audio/index.js"
import { buildAudioPipeline } from "./audio/pipeline.js"
import { BIG_BUFFER, ByteBuffer } from "./buffer.js"
import { initCrypto } from "./crypto.js"
import { defaultStreamInputConfig, StreamInput } from "./input.js"
import { Logger, LogMessageInfo } from "./log.js"
import { gatherPipeInfo, getPipe } from "./pipeline/index.js"
import { StreamStats } from "./stats.js"
import { Transport, TransportShutdown } from "./transport/index.js"
import { WebSocketChannelMux, WebSocketDataChannel } from "./transport/websocket_channel.js"
import { WebRTCTransport } from "./transport/webrtc.js"
import { allVideoCodecs, andVideoCodecs, createSupportedVideoFormatsBits, emptyVideoCodecs, getSelectedVideoCodec, hasAnyCodec, VideoCodecSupport } from "./video.js"
import { VideoRenderer } from "./video/index.js"
import { buildVideoPipeline, VideoPipelineOptions } from "./video/pipeline.js"

export type ExecutionEnvironment = {
    main: boolean
    worker: boolean
}

export type InfoEvent = CustomEvent<
    { type: "app", app: App } |
    { type: "serverMessage", message: string } |
    { type: "connectionComplete", capabilities: StreamCapabilities } |
    { type: "connectionStatus", status: ConnectionStatus } |
    { type: "addDebugLine", line: string, additional?: LogMessageInfo }
>
export type InfoEventListener = (event: InfoEvent) => void

export function getStreamerSize(settings: Settings, viewerScreenSize: [number, number]): [number, number] {
    // URL-specified resolution always takes priority (for embedded/grid views)
    // viewerScreenSize contains URL params if provided, otherwise viewport size
    const queryParams = new URLSearchParams(location.search)
    const urlWidth = queryParams.get("width")
    const urlHeight = queryParams.get("height")

    if (urlWidth && urlHeight) {
        // URL params override settings
        return [parseInt(urlWidth, 10), parseInt(urlHeight, 10)]
    }

    // Fall back to settings-based resolution
    let width, height
    if (settings.videoSize == "720p") {
        width = 1280
        height = 720
    } else if (settings.videoSize == "1080p") {
        width = 1920
        height = 1080
    } else if (settings.videoSize == "1440p") {
        width = 2560
        height = 1440
    } else if (settings.videoSize == "4k") {
        width = 3840
        height = 2160
    } else if (settings.videoSize == "custom") {
        width = settings.videoSizeCustom.width
        height = settings.videoSizeCustom.height
    } else { // native
        width = viewerScreenSize[0]
        height = viewerScreenSize[1]
    }
    return [width, height]
}

function getVideoCodecHint(settings: Settings): VideoCodecSupport {
    let videoCodecHint = emptyVideoCodecs()
    if (settings.videoCodec == "h264") {
        videoCodecHint.H264 = true
        videoCodecHint.H264_HIGH8_444 = true
    } else if (settings.videoCodec == "h265") {
        videoCodecHint.H265 = true
        videoCodecHint.H265_MAIN10 = true
        videoCodecHint.H265_REXT8_444 = true
        videoCodecHint.H265_REXT10_444 = true
    } else if (settings.videoCodec == "av1") {
        videoCodecHint.AV1 = true
        videoCodecHint.AV1_MAIN8 = true
        videoCodecHint.AV1_MAIN10 = true
        videoCodecHint.AV1_REXT8_444 = true
        videoCodecHint.AV1_REXT10_444 = true
    } else if (settings.videoCodec == "auto") {
        videoCodecHint = allVideoCodecs()
    }
    return videoCodecHint
}

export class Stream implements Component {
    private logger: Logger = new Logger()

    private api: Api

    private hostId: number
    private appId: number

    private settings: Settings

    private divElement = document.createElement("div")
    private eventTarget = new EventTarget()

    private ws: WebSocket
    private wsMux: WebSocketChannelMux = new WebSocketChannelMux()
    private wsChannels: Map<number, WebSocketDataChannel> = new Map()
    private iceServers: Array<RTCIceServer> | null = null

    private videoRenderer: VideoRenderer | null = null
    private audioPlayer: AudioPlayer | null = null

    private input: StreamInput
    private stats: StreamStats

    private streamerSize: [number, number]

    private streamT0: number = performance.now()
    private tPlus(): string { return `T+${Math.round(performance.now() - this.streamT0)}ms` }
    private wsOpenTimeout: ReturnType<typeof setTimeout> | null = null
    private hasSignaledConnectionComplete = false

    constructor(api: Api, hostId: number, appId: number, settings: Settings, viewerScreenSize: [number, number]) {
        this.streamT0 = performance.now()
        console.log(`[Stream-Browser ${this.tPlus()}] Stream constructor: hostId=${hostId}, appId=${appId}`)

        this.logger.addInfoListener((info, type) => {
            this.debugLog(info, { type: type ?? undefined })
        })

        this.api = api

        this.hostId = hostId
        this.appId = appId

        this.settings = settings

        this.streamerSize = getStreamerSize(settings, viewerScreenSize)

        // Configure web socket
        const wsApiHost = api.host_url.replace(/^http(s)?:/, "ws$1:")
        // TODO: firstly try out WebTransport
        this.ws = new WebSocket(`${wsApiHost}/host/stream`)
        this.ws.addEventListener("error", this.onError.bind(this))
        this.ws.addEventListener("open", this.onWsOpen.bind(this))
        this.ws.addEventListener("close", this.onWsClose.bind(this))
        this.ws.addEventListener("message", this.onRawWsMessage.bind(this))

        // WebSocket connection timeout: if WS doesn't open within 15s on bad internet,
        // signal failure to parent so DesktopView can show an error instead of loading forever.
        this.wsOpenTimeout = setTimeout(() => {
            if (this.ws.readyState !== WebSocket.OPEN) {
                console.log(`[Stream-Browser ${this.tPlus()}] WebSocket failed to open within 15s, closing`)
                this.ws.close()
                this.signalParentError("WebSocket connection timeout - server may be unreachable")
            }
        }, 15000)

        // Initialize encryption from URL fragment key
        initCrypto().catch((err) => {
            console.error("[Crypto] Failed to initialize encryption:", err)
        })

        // Create WebSocket-backed channels for reliable input (TCP semantics)
        // Mouse movement (MOUSE_RELATIVE, MOUSE_ABSOLUTE) uses WebRTC data channels
        // for low latency unreliable delivery (like video - UDP semantics)
        const wsChannelIds = [
            TransportChannelId.KEYBOARD,
            TransportChannelId.MOUSE_RELIABLE,
            TransportChannelId.CONTROLLERS,
            TransportChannelId.TOUCH,
            TransportChannelId.GENERAL,
            TransportChannelId.STATS,
            TransportChannelId.RTT,
        ]
        for (const id of wsChannelIds) {
            const channel = new WebSocketDataChannel(this.ws, id)
            this.wsChannels.set(id, channel)
            this.wsMux.register(id, channel)
        }
        // Controller slots 0-15
        for (let i = 0; i < 16; i++) {
            const id = TransportChannelId[`CONTROLLER${i}` as keyof typeof TransportChannelId]
            const channel = new WebSocketDataChannel(this.ws, id)
            this.wsChannels.set(id, channel)
            this.wsMux.register(id, channel)
        }

        this.sendWsMessage({
            Init: {
                host_id: this.hostId,
                app_id: this.appId,
                video_frame_queue_size: this.settings.videoFrameQueueSize,
                audio_sample_queue_size: this.settings.audioSampleQueueSize,
            }
        })

        // Stream Input
        const streamInputConfig = defaultStreamInputConfig()
        Object.assign(streamInputConfig, {
            mouseScrollMode: this.settings.mouseScrollMode,
            controllerConfig: this.settings.controllerConfig
        })
        this.input = new StreamInput(streamInputConfig)

        // Stream Stats
        this.stats = new StreamStats()
    }

    private debugLog(message: string, additional?: LogMessageInfo) {
        for (const line of message.split("\n")) {
            const event: InfoEvent = new CustomEvent("stream-info", {
                detail: { type: "addDebugLine", line, additional }
            })

            this.eventTarget.dispatchEvent(event)
        }
    }

    private async onMessage(message: StreamServerMessage) {
        if ("DebugLog" in message) {
            const debugLog = message.DebugLog

            this.debugLog(debugLog.message, {
                type: debugLog.ty ?? undefined
            })
        } else if ("UpdateApp" in message) {
            const event: InfoEvent = new CustomEvent("stream-info", {
                detail: { type: "app", app: message.UpdateApp.app }
            })

            this.eventTarget.dispatchEvent(event)
        } else if ("ConnectionComplete" in message) {
            console.log(`[Stream-Browser ${this.tPlus()}] ConnectionComplete received`)
            const capabilities = message.ConnectionComplete.capabilities
            const formatRaw = message.ConnectionComplete.format
            const width = message.ConnectionComplete.width
            const height = message.ConnectionComplete.height
            const fps = message.ConnectionComplete.fps

            const audioSampleRate = message.ConnectionComplete.audio_sample_rate
            const audioChannelCount = message.ConnectionComplete.audio_channel_count
            const audioStreams = message.ConnectionComplete.audio_streams
            const audioCoupledStreams = message.ConnectionComplete.audio_coupled_streams
            const audioSamplesPerFrame = message.ConnectionComplete.audio_samples_per_frame
            const audioMapping = message.ConnectionComplete.audio_mapping

            const format = getSelectedVideoCodec(formatRaw)
            if (format == null) {
                this.debugLog(`Video Format ${formatRaw} was not found! Couldn't start stream!`, { type: "fatal" })
                return
            }

            const event: InfoEvent = new CustomEvent("stream-info", {
                detail: { type: "connectionComplete", capabilities }
            })

            this.eventTarget.dispatchEvent(event)

            this.input.onStreamStart(capabilities, [width, height])

            this.stats.setVideoInfo(format ?? "Unknown", width, height, fps)
            // HDR state will be set when server sends HdrModeUpdate message
            // Don't initialize from settings.hdr because that's just the user's preference,
            // not the actual HDR state (which depends on host support, display, and codec)
            if (this.settings.hdr) {
                this.debugLog("HDR requested by user, waiting for host confirmation...")
            }

            // we should allow streaming without audio
            if (!this.audioPlayer) {
                showErrorPopup("Failed to find supported audio player -> audio is missing.")
            }

            await Promise.all([
                this.videoRenderer?.setup({
                    codec: format,
                    fps,
                    width,
                    height,
                }),
                this.audioPlayer?.setup({
                    sampleRate: audioSampleRate,
                    channels: audioChannelCount,
                    streams: audioStreams,
                    coupledStreams: audioCoupledStreams,
                    samplesPerFrame: audioSamplesPerFrame,
                    mapping: audioMapping,
                })
            ])
        } else if ("ConnectionTerminated" in message) {
            const code = message.ConnectionTerminated.error_code

            this.debugLog(`ConnectionTerminated with code ${code}`, { type: "fatalDescription" })
            this.signalParentError(`Server terminated connection (code ${code})`)
        }
        // -- WebRTC Config
        else if ("Setup" in message) {
            console.log(`[Stream-Browser ${this.tPlus()}] Setup message received (ICE servers)`)
            const iceServers = message.Setup.ice_servers

            this.iceServers = iceServers

            this.debugLog(`Using WebRTC Ice Servers: ${createPrettyList(
                iceServers.map(server => server.urls).reduce((list, url) => list.concat(url), [])
            )}`)

            await this.startConnection()
        }
        // -- WebRTC
        else if ("WebRtc" in message) {
            const webrtcMessage = message.WebRtc
            if (this.transport instanceof WebRTCTransport) {
                this.transport.onReceiveMessage(webrtcMessage)
            } else {
                this.debugLog(`Received WebRTC message but transport is currently ${this.transport?.implementationName}`)
            }
        }
    }

    async startConnection() {
        const MAX_ATTEMPTS = 10
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (attempt > 1) {
                // Exponential backoff: 500ms, 1s, 2s, 4s, ... capped at 5s
                const delay = Math.min(500 * Math.pow(2, attempt - 2), 5000)
                this.debugLog(`Retrying WebRTC connection (attempt ${attempt}/${MAX_ATTEMPTS}, waiting ${delay}ms)`)
                await new Promise(r => setTimeout(r, delay))
            }

            await this.tryWebRTCTransport()

            const transport = this.transport as any
            const shouldRetry = transport
                && (transport.dataChannelsFailed || transport.needsFullReconnection)
                && attempt < MAX_ATTEMPTS

            if (shouldRetry) {
                const reason = transport.dataChannelsFailed
                    ? "Data channels failed to open"
                    : "ICE failed after renegotiation"
                this.debugLog(`${reason}, retrying connection`)
                continue
            }

            return
        }

        this.debugLog("WebRTC connection failed after all retry attempts", { type: "fatal" })
        this.signalParentError("Connection failed after all retry attempts")
    }

    private transport: Transport | null = null
    private previousTransport: Transport | null = null

    private setTransport(transport: Transport, deferOldClose: boolean = false) {
        if (this.transport) {
            if (deferOldClose) {
                // Keep the old transport alive so its video track keeps the old renderer
                // showing the last frame instead of going black during reconnect.
                // Call closePreviousTransport() after the new pipeline is ready.
                this.previousTransport = this.transport
            } else {
                this.transport.close()
            }
        }

        this.transport = transport

        // Input: keyboard/clicks/gamepad/touch go over WebSocket (TCP, must arrive)
        // Mouse movement stays on WebRTC (UDP, can drop)
        this.input.setTransport(this.transport, this.wsChannels)
        this.stats.setTransport(this.transport)

        // RTT and GENERAL go over WebSocket (TCP, must arrive)
        const rtt = this.wsChannels.get(TransportChannelId.RTT)
        if (rtt) {
            rtt.addReceiveListener((data) => {
                const buffer = new ByteBuffer(data.byteLength)
                buffer.putU8Array(new Uint8Array(data))
                buffer.flip()

                const ty = buffer.getU8()
                if (ty == 0) {
                    rtt.send(data)
                }
            })
        } else {
            this.debugLog("Failed to get rtt WebSocket channel. Cannot respond to rtt packets")
        }

        // Setup GENERAL channel listener for HDR mode updates
        const generalChannel = this.wsChannels.get(TransportChannelId.GENERAL)
        if (generalChannel) {
            generalChannel.addReceiveListener((data: ArrayBuffer) => {
                this.onGeneralChannelMessage(data)
            })
            this.debugLog(`[GENERAL] GENERAL channel listener registered (WebSocket)`)
        } else {
            this.debugLog(`[GENERAL] No WebSocket channel for GENERAL`)
        }
    }

    private onGeneralChannelMessage(data: ArrayBuffer) {
        this.debugLog(`[GENERAL] Received message on GENERAL channel, size=${data.byteLength}`)
        const buffer = new Uint8Array(data)
        if (buffer.length < 2) {
            this.debugLog(`[GENERAL] Message too short: ${buffer.length} bytes`)
            return
        }

        const textLength = (buffer[0] << 8) | buffer[1]
        if (buffer.length < 2 + textLength) {
            this.debugLog(`[GENERAL] Message incomplete: expected ${2 + textLength} bytes, got ${buffer.length}`)
            return
        }

        const text = new TextDecoder().decode(buffer.slice(2, 2 + textLength))
        this.debugLog(`[GENERAL] Parsed message: ${text}`)
        try {
            const message: GeneralServerMessage = JSON.parse(text)
            this.handleGeneralMessage(message)
        } catch (err) {
            this.debugLog(`Failed to parse general message: ${err}`)
        }
    }

    private handleGeneralMessage(message: GeneralServerMessage) {
        if ("HdrModeUpdate" in message) {
            const hdrUpdate = message.HdrModeUpdate
            if (hdrUpdate) {
                const enabled = hdrUpdate.enabled
                this.debugLog(`HDR mode ${enabled ? "enabled" : "disabled"}`)
                this.setHdrMode(enabled)
            }
        } else if ("ConnectionStatusUpdate" in message) {
            const statusUpdate = message.ConnectionStatusUpdate
            if (statusUpdate) {
                const status = statusUpdate.status
                const event: InfoEvent = new CustomEvent("stream-info", {
                    detail: { type: "connectionStatus", status }
                })
                this.eventTarget.dispatchEvent(event)
            }
        }
    }

    private setHdrMode(enabled: boolean) {
        this.stats.setHdrEnabled(enabled)
        if (this.videoRenderer) {
            if ("setHdrMode" in this.videoRenderer && typeof this.videoRenderer.setHdrMode === "function") {
                this.videoRenderer.setHdrMode(enabled)
            }
        }
    }

    private closePreviousTransport() {
        if (this.previousTransport) {
            this.previousTransport.close()
            this.previousTransport = null
        }
    }

    private async tryWebRTCTransport(): Promise<TransportShutdown> {
        console.log(`[Stream-Browser ${this.tPlus()}] tryWebRTCTransport()`)
        this.debugLog("Trying WebRTC transport")

        this.sendWsMessage({
            SetTransport: "WebRTC"
        })

        if (!this.iceServers) {
            this.debugLog(`Failed to try WebRTC Transport: no ice servers available`)
            return "failednoconnect"
        }

        const transport = new WebRTCTransport(this.logger)
        transport.onsendmessage = (message) => this.sendWsMessage({ WebRtc: message })

        transport.initPeer({
            iceServers: this.iceServers,
        })
        // Defer closing the old transport so its video track keeps the old renderer
        // showing the last frame (frozen) instead of going black during reconnect.
        this.setTransport(transport, true)

        // Wait for negotiation with timeout.
        // High-latency connections (e.g. train WiFi, intercontinental) can take
        // 30s+ for ICE to complete. Without a timeout this promise hangs forever
        // leaving users on a gray "Connecting" screen.
        const NEGOTIATION_TIMEOUT_MS = 45_000
        const result = await (new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                console.log(`[Stream-Browser ${this.tPlus()}] WebRTC negotiation timed out after ${NEGOTIATION_TIMEOUT_MS}ms`)
                this.debugLog(`WebRTC negotiation timed out after ${NEGOTIATION_TIMEOUT_MS / 1000}s`)
                transport.onconnect = null
                transport.onclose = null
                resolve(false)
            }, NEGOTIATION_TIMEOUT_MS)
            transport.onconnect = () => { clearTimeout(timer); resolve(true) }
            transport.onclose = () => { clearTimeout(timer); resolve(false) }
        }))
        console.log(`[Stream-Browser ${this.tPlus()}] WebRTC negotiation success: ${result}`)
        this.debugLog(`WebRTC negotiation success: ${result}`)

        if (!result) {
            this.closePreviousTransport()
            return "failednoconnect"
        }

        // Print pipe support
        const pipesInfo = await gatherPipeInfo()

        this.logger.debug(`Supported Pipes: {`)
        let isFirst = true
        for (const [key, value] of pipesInfo.entries()) {
            this.logger.debug(`${isFirst ? "" : ","}"${getPipe(key)?.name}": ${JSON.stringify(value)}`)
            isFirst = false
        }
        this.logger.debug(`}`)

        const videoCodecSupport = await this.createPipelines()
        // New pipeline is ready (or failed) - now safe to close the previous transport.
        // The old video renderer has already been cleaned up inside createVideoRenderer().
        this.closePreviousTransport()

        if (!videoCodecSupport) {
            this.debugLog("No video pipeline was found for the codec that was specified. If you're unsure which codecs are supported use H264.", { type: "fatalDescription" })

            await transport.close()
            return "failednoconnect"
        }

        await this.startStream(videoCodecSupport)

        return new Promise((resolve, reject) => {
            transport.onclose = (shutdown) => {
                resolve(shutdown)
            }
        })
    }
    private async createPipelines(): Promise<VideoCodecSupport | null> {
        // Print supported pipes
        const pipesInfo = await gatherPipeInfo()

        this.logger.debug(`Supported Pipes: {`)
        let isFirst = true
        for (const [pipe, info] of pipesInfo) {
            this.logger.debug(`${isFirst ? "" : ","}"${pipe.name}": ${JSON.stringify(info)}`)
            isFirst = false
        }
        this.logger.debug(`}`)

        // Create pipelines
        const [supportedVideoCodecs] = await Promise.all([this.createVideoRenderer(), this.createAudioPlayer()])

        const videoPipeline = `${this.transport?.getChannel(TransportChannelId.HOST_VIDEO).type} (transport) -> ${this.videoRenderer?.implementationName} (renderer)`
        this.debugLog(`Using video pipeline: ${videoPipeline}`)

        const audioPipeline = `${this.transport?.getChannel(TransportChannelId.HOST_AUDIO).type} (transport) -> ${this.audioPlayer?.implementationName} (player)`
        this.debugLog(`Using audio pipeline: ${audioPipeline}`)

        this.stats.setVideoPipelineName(videoPipeline)
        this.stats.setAudioPipelineName(audioPipeline)

        return supportedVideoCodecs
    }
    private async createVideoRenderer(): Promise<VideoCodecSupport | null> {
        // Keep the old video renderer visible during reconnect to avoid black screen.
        // It will be cleaned up after the new one is mounted and receiving frames.
        const oldVideoRenderer = this.videoRenderer
        this.videoRenderer = null
        if (!this.transport) {
            this.debugLog("Failed to setup video without transport")
            return null
        }

        const codecHint = getVideoCodecHint(this.settings)
        this.debugLog(`Codec Hint by the user: ${JSON.stringify(codecHint)}`)

        if (!hasAnyCodec(codecHint)) {
            this.debugLog("Couldn't find any supported video format. Change the codec option to H264 in the settings if you're unsure which codecs are supported.", { type: "fatalDescription" })
            return null
        }

        const transportCodecSupport = await this.transport.setupHostVideo({
            type: ["videotrack", "data"]
        })
        this.debugLog(`Transport supports these video codecs: ${JSON.stringify(transportCodecSupport)}`)

        const videoSettings: VideoPipelineOptions = {
            supportedVideoCodecs: andVideoCodecs(codecHint, transportCodecSupport),
            canvasRenderer: this.settings.canvasRenderer,
            forceVideoElementRenderer: this.settings.forceVideoElementRenderer
        }

        let pipelineCodecSupport
        const video = this.transport.getChannel(TransportChannelId.HOST_VIDEO)
        if (video.type == "videotrack") {
            const { videoRenderer, supportedCodecs, error } = await buildVideoPipeline("videotrack", videoSettings, this.logger)

            if (error) {
                return null
            }
            pipelineCodecSupport = supportedCodecs

            videoRenderer.mount(this.divElement)

            video.addTrackListener((track) => {
                videoRenderer.setTrack(track)
            })

            this.videoRenderer = videoRenderer
        } else if (video.type == "data") {
            const { videoRenderer, supportedCodecs, error } = await buildVideoPipeline("data", videoSettings, this.logger)

            if (error) {
                return null
            }
            pipelineCodecSupport = supportedCodecs

            videoRenderer.mount(this.divElement)

            video.addReceiveListener((data) => {
                videoRenderer.submitPacket(data)

                // data pipeline support requesting idrs over video channel
                if (videoRenderer.pollRequestIdr()) {
                    const buffer = new ByteBuffer(1)

                    buffer.putU8(0)

                    buffer.flip()

                    video.send(buffer.getRemainingBuffer().buffer)
                }
            })

            this.videoRenderer = videoRenderer
        } else {
            this.debugLog(`Failed to create video pipeline with transport channel of type ${video.type} (${this.transport.implementationName})`)
            return null
        }

        // Now that new video renderer is mounted and receiving, clean up the old one.
        // This avoids a black screen gap during reconnect: old renderer stays visible
        // until the new one is ready to display frames.
        if (oldVideoRenderer) {
            this.debugLog("Cleaning up old video renderer after new one is ready")
            oldVideoRenderer.unmount(this.divElement)
            oldVideoRenderer.cleanup()
        }

        return pipelineCodecSupport
    }
    private async createAudioPlayer(): Promise<boolean> {
        if (this.audioPlayer) {
            this.debugLog("Found an old audio player -> cleaning it up")

            this.audioPlayer.unmount(this.divElement)
            this.audioPlayer.cleanup()
            this.audioPlayer = null
        }
        if (!this.transport) {
            this.debugLog("Failed to setup audio without transport")
            return false
        }

        this.transport.setupHostAudio({
            type: ["audiotrack", "data"]
        })

        const audio = this.transport?.getChannel(TransportChannelId.HOST_AUDIO)
        if (audio.type == "audiotrack") {
            const { audioPlayer, error } = await buildAudioPipeline("audiotrack", this.settings, this.logger)

            if (error) {
                return false
            }

            audioPlayer.mount(this.divElement)

            audio.addTrackListener((track) => audioPlayer.setTrack(track))

            this.audioPlayer = audioPlayer
        } else if (audio.type == "data") {
            const { audioPlayer, error } = await buildAudioPipeline("data", this.settings, this.logger)

            if (error) {
                return false
            }

            audioPlayer.mount(this.divElement)

            audio.addReceiveListener((data) => {
                audioPlayer.decodeAndPlay({
                    // TODO: fill in duration and timestamp
                    durationMicroseconds: 0,
                    timestampMicroseconds: 0,
                    data
                })
            })

            this.audioPlayer = audioPlayer
        } else {
            this.debugLog(`Cannot find audio pipeline for transport type "${audio.type}"`)
            return false
        }

        return true
    }
    private async startStream(videoCodecSupport: VideoCodecSupport): Promise<void> {
        console.log(`[Stream-Browser ${this.tPlus()}] startStream() sending StartStream message`)
        const message: StreamClientMessage = {
            StartStream: {
                bitrate: this.settings.bitrate,
                packet_size: this.settings.packetSize,
                fps: this.settings.fps,
                width: this.streamerSize[0],
                height: this.streamerSize[1],
                play_audio_local: this.settings.playAudioLocal,
                video_supported_formats: createSupportedVideoFormatsBits(videoCodecSupport),
                video_colorspace: "Rec709",
                video_color_range_full: false,
                hdr: this.settings.hdr ?? false,
            }
        }
        this.debugLog(`Starting stream with info: ${JSON.stringify(message)}`)
        this.debugLog(`Stream video codec info: ${JSON.stringify(videoCodecSupport)}`)

        // Log HDR requirements if HDR is requested
        if (this.settings.hdr) {
            const hasHdrCodec = videoCodecSupport.H265_MAIN10 || videoCodecSupport.AV1_MAIN10
            if (!hasHdrCodec) {
                this.debugLog(`Warning: HDR requested but no 10-bit codec available. HDR requires H265_MAIN10 or AV1_MAIN10 support.`)
            } else {
                this.debugLog(`HDR codec available: H265_MAIN10=${videoCodecSupport.H265_MAIN10}, AV1_MAIN10=${videoCodecSupport.AV1_MAIN10}`)
            }
        }

        this.sendWsMessage(message)
    }

    mount(parent: HTMLElement): void {
        parent.appendChild(this.divElement)
    }
    unmount(parent: HTMLElement): void {
        parent.removeChild(this.divElement)
    }

    getVideoRenderer(): VideoRenderer | null {
        return this.videoRenderer
    }
    getAudioPlayer(): AudioPlayer | null {
        return this.audioPlayer
    }

    // -- Raw Web Socket stuff
    private wsSendBuffer: Array<string> = []

    private onWsOpen() {
        console.log(`[Stream-Browser ${this.tPlus()}] WebSocket open`)
        this.debugLog(`Web Socket Open`)

        if (this.wsOpenTimeout) {
            clearTimeout(this.wsOpenTimeout)
            this.wsOpenTimeout = null
        }

        for (const raw of this.wsSendBuffer.splice(0)) {
            this.ws.send(raw)
        }
    }
    private onWsClose() {
        console.log(`[Stream-Browser ${this.tPlus()}] WebSocket closed`)
        this.debugLog(`Web Socket Closed`)
        // Signal parent that connection is lost if we never completed, or if WS dies mid-stream
        this.signalParentError("WebSocket connection closed")
    }
    private onError(event: Event) {
        this.debugLog(`Web Socket or WebRtcPeer Error`)

        console.error(`Web Socket or WebRtcPeer Error`, event)
    }

    // Signal failure to parent iframe (DesktopView.tsx) so it can show error UI
    // instead of being stuck on "Establishing video stream..." forever
    private signalParentError(reason: string) {
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'stream-error', payload: { message: reason } }, '*')
        }
    }
    private signalParentDisconnected(reason: string) {
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'stream-disconnected', payload: { reason } }, '*')
        }
    }

    private sendWsMessage(message: StreamClientMessage) {
        const raw = JSON.stringify(message)
        if (this.ws.readyState == WebSocket.OPEN) {
            this.ws.send(raw)
        } else {
            this.wsSendBuffer.push(raw)
        }
    }
    private onRawWsMessage(event: MessageEvent) {
        const message = event.data
        if (typeof message == "string") {
            // JSON signaling message
            const json = JSON.parse(message)
            this.onMessage(json)
        } else if (message instanceof ArrayBuffer) {
            // Binary encrypted channel message - route through mux
            this.wsMux.handleMessage(new Uint8Array(message)).catch((err) => {
                console.warn("[WS-Mux] Failed to handle binary message:", err)
            })
        }
    }

    // -- Class Api
    addInfoListener(listener: InfoEventListener) {
        this.eventTarget.addEventListener("stream-info", listener as EventListenerOrEventListenerObject)
    }
    removeInfoListener(listener: InfoEventListener) {
        this.eventTarget.removeEventListener("stream-info", listener as EventListenerOrEventListenerObject)
    }

    getInput(): StreamInput {
        return this.input
    }
    getStats(): StreamStats {
        return this.stats
    }

    getStreamerSize(): [number, number] {
        return this.streamerSize
    }
}

function createPrettyList(list: Array<string>): string {
    let isFirst = true
    let text = "["
    for (const item of list) {
        if (!isFirst) {
            text += ", "
        }
        isFirst = false

        text += item
    }
    text += "]"

    return text
}