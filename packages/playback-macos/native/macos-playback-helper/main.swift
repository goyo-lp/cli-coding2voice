import AVFoundation
import Foundation

enum PlaybackHelperError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case invalidWav(String)
    case unsupportedFormat(String)
    case unexpectedEOF

    var description: String {
        switch self {
        case .invalidArguments(let message):
            return message
        case .invalidWav(let message):
            return message
        case .unsupportedFormat(let message):
            return message
        case .unexpectedEOF:
            return "Unexpected end of input while reading audio stream."
        }
    }
}

struct ParsedWavChunk {
    let channels: AVAudioChannelCount
    let sampleRate: Double
    let bitsPerSample: UInt16
    let formatCode: UInt16
    let frameCount: AVAudioFrameCount
    let data: Data

    var commonFormat: AVAudioCommonFormat {
        if formatCode == 3 && bitsPerSample == 32 {
            return .pcmFormatFloat32
        }
        return .pcmFormatInt16
    }
}

func readUInt16LE(_ data: Data, _ offset: Int) -> UInt16 {
    let byte0 = UInt16(data[offset])
    let byte1 = UInt16(data[offset + 1]) << 8
    return byte0 | byte1
}

func readUInt32LE(_ data: Data, _ offset: Int) -> UInt32 {
    let byte0 = UInt32(data[offset])
    let byte1 = UInt32(data[offset + 1]) << 8
    let byte2 = UInt32(data[offset + 2]) << 16
    let byte3 = UInt32(data[offset + 3]) << 24
    return byte0 | byte1 | byte2 | byte3
}

func readChunkID(_ data: Data, _ offset: Int) -> String {
    let chunkData = data.subdata(in: offset..<(offset + 4))
    return String(decoding: chunkData, as: UTF8.self)
}

func parseWavChunk(_ data: Data) throws -> ParsedWavChunk {
    guard data.count >= 44 else {
        throw PlaybackHelperError.invalidWav("WAV chunk is too small.")
    }

    guard readChunkID(data, 0) == "RIFF", readChunkID(data, 8) == "WAVE" else {
        throw PlaybackHelperError.invalidWav("WAV header is missing RIFF/WAVE identifiers.")
    }

    var channels: UInt16?
    var sampleRate: UInt32?
    var bitsPerSample: UInt16?
    var formatCode: UInt16?
    var blockAlign: UInt16?
    var audioData: Data?
    var offset = 12

    while offset + 8 <= data.count {
        let chunkID = readChunkID(data, offset)
        let chunkSize = Int(readUInt32LE(data, offset + 4))
        let chunkStart = offset + 8
        let chunkEnd = chunkStart + chunkSize
        guard chunkEnd <= data.count else {
            throw PlaybackHelperError.invalidWav("WAV chunk \(chunkID) extends past the provided data.")
        }

        switch chunkID {
        case "fmt ":
            guard chunkSize >= 16 else {
                throw PlaybackHelperError.invalidWav("WAV fmt chunk is incomplete.")
            }
            formatCode = readUInt16LE(data, chunkStart)
            channels = readUInt16LE(data, chunkStart + 2)
            sampleRate = readUInt32LE(data, chunkStart + 4)
            blockAlign = readUInt16LE(data, chunkStart + 12)
            bitsPerSample = readUInt16LE(data, chunkStart + 14)
        case "data":
            audioData = data.subdata(in: chunkStart..<chunkEnd)
        default:
            break
        }

        offset = chunkEnd + (chunkSize % 2)
    }

    guard let resolvedChannels = channels,
          let resolvedSampleRate = sampleRate,
          let resolvedBitsPerSample = bitsPerSample,
          let resolvedFormatCode = formatCode,
          let resolvedBlockAlign = blockAlign,
          let resolvedAudioData = audioData
    else {
        throw PlaybackHelperError.invalidWav("WAV chunk is missing fmt or data information.")
    }

    guard resolvedChannels > 0 else {
        throw PlaybackHelperError.invalidWav("WAV channel count must be greater than zero.")
    }

    if !(resolvedFormatCode == 3 && resolvedBitsPerSample == 32) && !(resolvedFormatCode == 1 && resolvedBitsPerSample == 16) {
        throw PlaybackHelperError.unsupportedFormat(
            "Unsupported WAV encoding format=\(resolvedFormatCode) bits=\(resolvedBitsPerSample)."
        )
    }

    let blockSize = Int(resolvedBlockAlign)
    guard blockSize > 0, resolvedAudioData.count % blockSize == 0 else {
        throw PlaybackHelperError.invalidWav("WAV data chunk size does not match the frame alignment.")
    }

    return ParsedWavChunk(
        channels: AVAudioChannelCount(resolvedChannels),
        sampleRate: Double(resolvedSampleRate),
        bitsPerSample: resolvedBitsPerSample,
        formatCode: resolvedFormatCode,
        frameCount: AVAudioFrameCount(resolvedAudioData.count / blockSize),
        data: resolvedAudioData
    )
}

func copyFloat32Samples(_ parsed: ParsedWavChunk, into buffer: AVAudioPCMBuffer) throws {
    guard let channels = buffer.floatChannelData else {
        throw PlaybackHelperError.invalidWav("Unable to access float32 channel data for playback buffer.")
    }

    let frameCount = Int(parsed.frameCount)
    let channelCount = Int(parsed.channels)
    parsed.data.withUnsafeBytes { rawBytes in
        let samples = rawBytes.bindMemory(to: Float32.self)
        for channelIndex in 0..<channelCount {
            let destination = channels[channelIndex]
            for frameIndex in 0..<frameCount {
                destination[frameIndex] = samples[frameIndex * channelCount + channelIndex]
            }
        }
    }
}

func copyInt16Samples(_ parsed: ParsedWavChunk, into buffer: AVAudioPCMBuffer) throws {
    guard let channels = buffer.int16ChannelData else {
        throw PlaybackHelperError.invalidWav("Unable to access int16 channel data for playback buffer.")
    }

    let frameCount = Int(parsed.frameCount)
    let channelCount = Int(parsed.channels)
    parsed.data.withUnsafeBytes { rawBytes in
        let samples = rawBytes.bindMemory(to: Int16.self)
        for channelIndex in 0..<channelCount {
            let destination = channels[channelIndex]
            for frameIndex in 0..<frameCount {
                destination[frameIndex] = samples[frameIndex * channelCount + channelIndex]
            }
        }
    }
}

func makePCMBuffer(from parsed: ParsedWavChunk) throws -> AVAudioPCMBuffer {
    guard let format = AVAudioFormat(
        commonFormat: parsed.commonFormat,
        sampleRate: parsed.sampleRate,
        channels: parsed.channels,
        interleaved: false
    ) else {
        throw PlaybackHelperError.invalidWav("Unable to construct AVAudioFormat for playback.")
    }

    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: parsed.frameCount) else {
        throw PlaybackHelperError.invalidWav("Unable to allocate AVAudioPCMBuffer.")
    }

    buffer.frameLength = parsed.frameCount

    switch parsed.commonFormat {
    case .pcmFormatFloat32:
        try copyFloat32Samples(parsed, into: buffer)
    case .pcmFormatInt16:
        try copyInt16Samples(parsed, into: buffer)
    default:
        throw PlaybackHelperError.unsupportedFormat("Unsupported AVAudioCommonFormat \(parsed.commonFormat.rawValue).")
    }

    return buffer
}

final class StreamingPlaybackEngine {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let varispeed = AVAudioUnitVarispeed()
    private let stateQueue = DispatchQueue(label: "cli2voice.playback.helper.state")
    private let drainedSemaphore = DispatchSemaphore(value: 0)
    private var didSignalDrain = false
    private var pendingBufferCount = 0
    private var didFinishInput = false
    private var preparedFormat: AVAudioFormat?

    init(rate: Float) {
        varispeed.rate = rate
    }

    deinit {
        stop()
    }

    func enqueue(wavData: Data) throws {
        let parsed = try parseWavChunk(wavData)
        try prepareIfNeeded(for: parsed)
        guard let format = preparedFormat else {
            throw PlaybackHelperError.invalidWav("Playback format was not prepared.")
        }

        guard format.sampleRate == parsed.sampleRate, format.channelCount == parsed.channels else {
            throw PlaybackHelperError.invalidWav("Streaming chunks must use a consistent sample rate and channel count.")
        }

        let buffer = try makePCMBuffer(from: parsed)
        stateQueue.sync {
            pendingBufferCount += 1
        }

        player.scheduleBuffer(buffer) { [weak self] in
            self?.markBufferComplete()
        }

        if !player.isPlaying {
            player.play()
        }
    }

    func finishInput() {
        let shouldSignal = stateQueue.sync { () -> Bool in
            didFinishInput = true
            if pendingBufferCount == 0 && !didSignalDrain {
                didSignalDrain = true
                return true
            }
            return false
        }

        if shouldSignal {
            drainedSemaphore.signal()
        }
    }

    func waitUntilDrained() {
        drainedSemaphore.wait()
    }

    func stop() {
        player.stop()
        engine.stop()
    }

    private func prepareIfNeeded(for parsed: ParsedWavChunk) throws {
        if preparedFormat != nil {
            return
        }

        guard let format = AVAudioFormat(
            commonFormat: parsed.commonFormat,
            sampleRate: parsed.sampleRate,
            channels: parsed.channels,
            interleaved: false
        ) else {
            throw PlaybackHelperError.invalidWav("Unable to prepare playback format.")
        }

        engine.attach(player)
        engine.attach(varispeed)
        engine.connect(player, to: varispeed, format: format)
        engine.connect(varispeed, to: engine.mainMixerNode, format: format)
        engine.prepare()
        try engine.start()
        preparedFormat = format
    }

    private func markBufferComplete() {
        let shouldSignal = stateQueue.sync { () -> Bool in
            pendingBufferCount = max(0, pendingBufferCount - 1)
            if didFinishInput && pendingBufferCount == 0 && !didSignalDrain {
                didSignalDrain = true
                return true
            }
            return false
        }

        if shouldSignal {
            drainedSemaphore.signal()
        }
    }
}

func parsePlaybackRate(arguments: [String]) throws -> Float {
    guard arguments.count >= 2, arguments[1] == "stream" else {
        throw PlaybackHelperError.invalidArguments("Usage: cli2voice-playback-helper stream [--rate 1.0]")
    }

    var rate: Float = 1
    var index = 2
    while index < arguments.count {
        let token = arguments[index]
        if token == "--rate" {
            guard index + 1 < arguments.count, let parsed = Float(arguments[index + 1]) else {
                throw PlaybackHelperError.invalidArguments("Expected a numeric value after --rate.")
            }
            rate = max(0.5, min(2.5, parsed))
            index += 2
            continue
        }
        throw PlaybackHelperError.invalidArguments("Unknown playback helper argument: \(token)")
    }

    return rate
}

func readExactly(_ count: Int) throws -> Data? {
    if count == 0 {
        return Data()
    }

    var collected = Data()
    while collected.count < count {
        let remaining = count - collected.count
        guard let chunk = try FileHandle.standardInput.read(upToCount: remaining) else {
            if collected.isEmpty {
                return nil
            }
            throw PlaybackHelperError.unexpectedEOF
        }

        if chunk.isEmpty {
            if collected.isEmpty {
                return nil
            }
            throw PlaybackHelperError.unexpectedEOF
        }

        collected.append(chunk)
    }

    return collected
}

func run() throws {
    let rate = try parsePlaybackRate(arguments: CommandLine.arguments)
    let playback = StreamingPlaybackEngine(rate: rate)
    defer {
        playback.stop()
    }

    while true {
        guard let header = try readExactly(4) else {
            playback.finishInput()
            break
        }

        let length =
            (UInt32(header[0]) << 24)
            | (UInt32(header[1]) << 16)
            | (UInt32(header[2]) << 8)
            | UInt32(header[3])

        if length == 0 {
            playback.finishInput()
            break
        }

        guard let chunk = try readExactly(Int(length)) else {
            throw PlaybackHelperError.unexpectedEOF
        }

        try playback.enqueue(wavData: chunk)
    }

    playback.waitUntilDrained()
}

do {
    try run()
} catch {
    let message: String
    if let helperError = error as? PlaybackHelperError {
        message = helperError.description
    } else {
        message = error.localizedDescription
    }
    FileHandle.standardError.write(Data("cli2voice playback helper: \(message)\n".utf8))
    exit(1)
}
