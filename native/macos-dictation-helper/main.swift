import AVFoundation
import CoreGraphics
import Foundation
import Speech

enum Shortcut: String {
    case rightOption = "right_option"
    case controlV = "control_v"
}

enum Backend: String {
    case auto = "auto"
    case macosNative = "macos_native"
    case daemonWhisper = "daemon_whisper"
}

struct EventPayload: Encodable {
    let type: String
    let shortcut: String?
    let backend: String?
    let audioPath: String?
    let reason: String?
    let text: String?
    let message: String?
}

func emit(_ payload: EventPayload) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(payload) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

func emitError(_ message: String) {
    emit(EventPayload(type: "error", shortcut: nil, backend: nil, audioPath: nil, reason: nil, text: nil, message: message))
}

final class DictationHelper: NSObject {
    private let shortcut: Shortcut
    private let requestedBackend: Backend
    private let language: String?
    private let partialResults: Bool
    private let maxRecordingMs: Int
    private var recorder: AVAudioRecorder?
    private var currentAudioPath: String?
    private var timeoutItem: DispatchWorkItem?
    private var eventTap: CFMachPort?
    private var rightOptionIsDown = false
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?
    private var latestTranscript = ""
    private var nativeSessionActive = false
    private var nativeCaptureEnded = false
    private var didEmitNativeFinal = false
    private var activeStopReason = "released"

    init(shortcut: Shortcut, backend: Backend, language: String?, partialResults: Bool, maxRecordingMs: Int) {
        self.shortcut = shortcut
        self.requestedBackend = backend
        self.language = language?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? language?.trimmingCharacters(in: .whitespacesAndNewlines)
            : nil
        self.partialResults = partialResults
        self.maxRecordingMs = maxRecordingMs
        super.init()
    }

    func run() {
        requestMicrophoneAccess()
        installEventTap()
        CFRunLoopRun()
    }

    private func requestMicrophoneAccess() {
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            granted = allowed
            semaphore.signal()
        }
        semaphore.wait()

        if !granted {
            emitError("Microphone permission was not granted.")
            exit(1)
        }
    }

    private func requestSpeechRecognitionAccess() -> Bool {
        let currentStatus = SFSpeechRecognizer.authorizationStatus()
        if currentStatus == .authorized {
            return true
        }
        if currentStatus == .denied || currentStatus == .restricted {
            return false
        }

        let semaphore = DispatchSemaphore(value: 0)
        var status: SFSpeechRecognizerAuthorizationStatus = .notDetermined
        SFSpeechRecognizer.requestAuthorization { nextStatus in
            status = nextStatus
            semaphore.signal()
        }
        semaphore.wait()
        return status == .authorized
    }

    private func installEventTap() {
        let mask =
            (1 << CGEventType.keyDown.rawValue)
            | (1 << CGEventType.keyUp.rawValue)
            | (1 << CGEventType.flagsChanged.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, userInfo in
            guard let userInfo else {
                return Unmanaged.passUnretained(event)
            }

            let helper = Unmanaged<DictationHelper>.fromOpaque(userInfo).takeUnretainedValue()
            helper.handle(eventType: type, event: event)
            return Unmanaged.passUnretained(event)
        }

        let opaqueSelf = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: callback,
            userInfo: opaqueSelf
        ) else {
            emitError("Unable to install keyboard event tap. Check Accessibility permissions.")
            exit(1)
        }

        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func handle(eventType: CGEventType, event: CGEvent) {
        switch shortcut {
        case .rightOption:
            handleRightOption(eventType: eventType, event: event)
        case .controlV:
            handleControlV(eventType: eventType, event: event)
        }
    }

    private func handleRightOption(eventType: CGEventType, event: CGEvent) {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        guard keyCode == 61 else { return }

        if eventType == .flagsChanged {
            let isPressed = event.flags.contains(.maskAlternate)
            if isPressed && !rightOptionIsDown {
                rightOptionIsDown = true
                startRecording()
            } else if !isPressed && rightOptionIsDown {
                rightOptionIsDown = false
                stopRecording(reason: "released")
            }
            return
        }

        if eventType == .keyDown {
            rightOptionIsDown = true
            startRecording()
        } else if eventType == .keyUp {
            rightOptionIsDown = false
            stopRecording(reason: "released")
        }
    }

    private func handleControlV(eventType: CGEventType, event: CGEvent) {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        if eventType == .keyDown {
            guard keyCode == 9 else { return }
            guard event.flags.contains(.maskControl) else { return }
            startRecording()
        } else if eventType == .keyUp, [9, 59, 62].contains(Int(keyCode)) {
            stopRecording(reason: "released")
        }
    }

    private func startRecording() {
        guard recorder == nil, !nativeSessionActive else { return }

        guard let backend = resolveBackend() else {
            return
        }

        switch backend {
        case .daemonWhisper:
            startFileRecording()
        case .macosNative:
            startNativeRecognition()
        case .auto:
            return
        }
    }

    private func stopRecording(reason: String) {
        if recorder != nil {
            stopFileRecording(reason: reason)
            return
        }

        if nativeSessionActive {
            stopNativeRecognition(reason: reason)
        }
    }

    private func resolveBackend() -> Backend? {
        if requestedBackend == .daemonWhisper {
            return .daemonWhisper
        }

        let speechGranted = requestSpeechRecognitionAccess()
        if !speechGranted {
            if requestedBackend == .auto {
                emitError("Speech recognition permission was not granted. Falling back to daemon_whisper.")
                return .daemonWhisper
            }
            emitError("Speech recognition permission was not granted.")
            return nil
        }

        guard let recognizer = createSpeechRecognizer() else {
            if requestedBackend == .auto {
                emitError("Speech recognition is unavailable for the selected language. Falling back to daemon_whisper.")
                return .daemonWhisper
            }
            emitError("Speech recognition is unavailable for the selected language.")
            return nil
        }

        speechRecognizer = recognizer
        return .macosNative
    }

    private func createSpeechRecognizer() -> SFSpeechRecognizer? {
        if let language {
            return SFSpeechRecognizer(locale: Locale(identifier: language))
        }
        return SFSpeechRecognizer()
    }

    private func startFileRecording() {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("cli2voice-dictation", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let fileURL = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false
        ]

        do {
            let nextRecorder = try AVAudioRecorder(url: fileURL, settings: settings)
            nextRecorder.isMeteringEnabled = false
            nextRecorder.prepareToRecord()
            nextRecorder.record()
            recorder = nextRecorder
            currentAudioPath = fileURL.path
            emit(
                EventPayload(
                    type: "recording_started",
                    shortcut: shortcut.rawValue,
                    backend: Backend.daemonWhisper.rawValue,
                    audioPath: nil,
                    reason: nil,
                    text: nil,
                    message: nil
                )
            )

            scheduleTimeout()
        } catch {
            emitError("Unable to start recording: \(error.localizedDescription)")
        }
    }

    private func stopFileRecording(reason: String) {
        guard let activeRecorder = recorder, let audioPath = currentAudioPath else { return }
        timeoutItem?.cancel()
        timeoutItem = nil
        activeRecorder.stop()
        recorder = nil
        currentAudioPath = nil

        emit(
            EventPayload(
                type: "recording_stopped",
                shortcut: shortcut.rawValue,
                backend: Backend.daemonWhisper.rawValue,
                audioPath: audioPath,
                reason: reason,
                text: nil,
                message: nil
            )
        )
    }

    private func startNativeRecognition() {
        guard let recognizer = speechRecognizer ?? createSpeechRecognizer() else {
            emitError("Speech recognition is unavailable for the selected language.")
            return
        }

        latestTranscript = ""
        nativeSessionActive = true
        nativeCaptureEnded = false
        didEmitNativeFinal = false
        activeStopReason = "released"

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = partialResults
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }

        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        recognitionRequest = request
        audioEngine = engine
        speechRecognizer = recognizer

        emit(
            EventPayload(
                type: "recording_started",
                shortcut: shortcut.rawValue,
                backend: Backend.macosNative.rawValue,
                audioPath: nil,
                reason: nil,
                text: nil,
                message: nil
            )
        )

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            self?.handleRecognition(result: result, error: error)
        }

        do {
            engine.prepare()
            try engine.start()
            scheduleTimeout()
        } catch {
            inputNode.removeTap(onBus: 0)
            emitError("Unable to start streaming dictation: \(error.localizedDescription)")
            resetNativeSession(cancelTask: true)
        }
    }

    private func stopNativeRecognition(reason: String) {
        guard nativeSessionActive, !nativeCaptureEnded else { return }
        nativeCaptureEnded = true
        activeStopReason = reason
        timeoutItem?.cancel()
        timeoutItem = nil

        if let engine = audioEngine, engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()

        emit(
            EventPayload(
                type: "recording_stopped",
                shortcut: shortcut.rawValue,
                backend: Backend.macosNative.rawValue,
                audioPath: nil,
                reason: reason,
                text: nil,
                message: nil
            )
        )
    }

    private func handleRecognition(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result {
            let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                latestTranscript = text
            }

            if result.isFinal {
                emitNativeFinalTranscript()
                resetNativeSession(cancelTask: false)
                return
            }

            if partialResults && !text.isEmpty {
                emit(
                    EventPayload(
                        type: "transcript_partial",
                        shortcut: shortcut.rawValue,
                        backend: Backend.macosNative.rawValue,
                        audioPath: nil,
                        reason: nil,
                        text: text,
                        message: nil
                    )
                )
            }
        }

        if let error {
            if isNoSpeechError(error) {
                emitNativeFinalTranscript()
                resetNativeSession(cancelTask: true)
                return
            }
            if !didEmitNativeFinal {
                emitNativeFinalTranscript()
            }
            emitError("Speech recognition failed: \(error.localizedDescription)")
            resetNativeSession(cancelTask: true)
        }
    }

    private func isNoSpeechError(_ error: Error) -> Bool {
        let message = (error as NSError).localizedDescription.lowercased()
        return message.contains("no speech detected")
    }

    private func emitNativeFinalTranscript() {
        guard nativeSessionActive, !didEmitNativeFinal else { return }
        didEmitNativeFinal = true
        let finalText = latestTranscript.trimmingCharacters(in: .whitespacesAndNewlines)

        if finalText.isEmpty {
            emit(
                EventPayload(
                    type: "transcript_empty",
                    shortcut: shortcut.rawValue,
                    backend: Backend.macosNative.rawValue,
                    audioPath: nil,
                    reason: activeStopReason,
                    text: nil,
                    message: nil
                )
            )
            return
        }

        emit(
            EventPayload(
                type: "transcript_final",
                shortcut: shortcut.rawValue,
                backend: Backend.macosNative.rawValue,
                audioPath: nil,
                reason: activeStopReason,
                text: finalText,
                message: nil
            )
        )
    }

    private func resetNativeSession(cancelTask: Bool) {
        timeoutItem?.cancel()
        timeoutItem = nil

        if let engine = audioEngine, engine.isRunning {
            engine.stop()
        }
        audioEngine?.inputNode.removeTap(onBus: 0)

        if cancelTask {
            recognitionTask?.cancel()
        }

        recognitionTask = nil
        recognitionRequest = nil
        audioEngine = nil
        latestTranscript = ""
        nativeSessionActive = false
        nativeCaptureEnded = false
        didEmitNativeFinal = false
    }

    private func scheduleTimeout() {
        let timeout = DispatchWorkItem { [weak self] in
            self?.stopRecording(reason: "timeout")
        }
        timeoutItem = timeout
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(maxRecordingMs), execute: timeout)
    }
}

func parseArguments() -> (shortcut: Shortcut, backend: Backend, language: String?, partialResults: Bool, maxRecordingMs: Int)? {
    let args = CommandLine.arguments.dropFirst()
    guard args.first == "listen" else {
        fputs(
            "Usage: cli2voice-dictation-helper listen --shortcut <right_option|control_v> --backend <auto|macos_native|daemon_whisper> --language <code> --partial-results <true|false> --max-recording-ms <ms>\n",
            stderr
        )
        return nil
    }

    var shortcut: Shortcut = .rightOption
    var backend: Backend = .auto
    var language: String?
    var partialResults = true
    var maxRecordingMs = 60_000
    let tokens = Array(args.dropFirst())
    var index = 0
    while index < tokens.count {
        let token = tokens[index]
        if token == "--shortcut", index + 1 < tokens.count {
            shortcut = Shortcut(rawValue: tokens[index + 1]) ?? .rightOption
            index += 2
            continue
        }
        if token == "--backend", index + 1 < tokens.count {
            backend = Backend(rawValue: tokens[index + 1]) ?? .auto
            index += 2
            continue
        }
        if token == "--language", index + 1 < tokens.count {
            language = tokens[index + 1]
            index += 2
            continue
        }
        if token == "--partial-results", index + 1 < tokens.count {
            partialResults = (tokens[index + 1] as NSString).boolValue
            index += 2
            continue
        }
        if token == "--max-recording-ms", index + 1 < tokens.count {
            maxRecordingMs = Int(tokens[index + 1]) ?? 60_000
            index += 2
            continue
        }
        index += 1
    }

    return (shortcut, backend, language, partialResults, maxRecordingMs)
}

guard let arguments = parseArguments() else {
    exit(2)
}

let helper = DictationHelper(
    shortcut: arguments.shortcut,
    backend: arguments.backend,
    language: arguments.language,
    partialResults: arguments.partialResults,
    maxRecordingMs: arguments.maxRecordingMs
)
helper.run()
