#if os(iOS)
import AVFoundation
import Speech

@MainActor
final class AppleDictationCapture: DictationCapture {
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var interruption: NSObjectProtocol?
    private var audioActive = false
    private var tapInstalled = false

    func authorize() async throws {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speech == .authorized else { throw DictationFailure.speechPermission }
        guard !Task.isCancelled else { throw CancellationError() }
        let microphone = await AVAudioApplication.requestRecordPermission()
        guard microphone else { throw DictationFailure.microphonePermission }
    }

    func start(update: @escaping @MainActor (DictationResult) -> Void, completion: @escaping @MainActor (Error?) -> Void) throws {
        cancel()
        guard let recognizer = SFSpeechRecognizer(locale: .current), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else { throw DictationFailure.unavailable }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers, .allowBluetoothHFP])
        try session.setActive(true)
        audioActive = true

        let engine = AVAudioEngine()
        self.engine = engine
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        request.taskHint = .dictation
        self.request = request

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw DictationFailure.microphoneUnavailable }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        tapInstalled = true
        recognition = recognizer.recognitionTask(with: request) { result, error in
            let transcript = result.map { DictationResult(text: $0.bestTranscription.formattedString,
                finalizedUtteranceStart: $0.speechRecognitionMetadata?.speechStartTimestamp) }
            let final = result?.isFinal ?? false
            Task { @MainActor in
                if let transcript { update(transcript) }
                if final || error != nil { completion(error) }
            }
        }
        interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { notification in
            guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  type == AVAudioSession.InterruptionType.began.rawValue else { return }
            Task { @MainActor in completion(DictationFailure.interrupted) }
        }
        engine.prepare()
        try engine.start()
    }

    func finish() {
        stopMicrophone()
        request?.endAudio()
        recognition?.finish()
    }

    func cancel() {
        stopMicrophone()
        request?.endAudio()
        recognition?.cancel()
        recognition = nil
        request = nil
        if let interruption { NotificationCenter.default.removeObserver(interruption) }
        interruption = nil
    }

    private func stopMicrophone() {
        engine?.stop()
        if tapInstalled { engine?.inputNode.removeTap(onBus: 0) }
        tapInstalled = false
        engine = nil
        if audioActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        audioActive = false
    }
}

private enum DictationFailure: LocalizedError {
    case speechPermission, microphonePermission, unavailable, microphoneUnavailable, interrupted
    var errorDescription: String? {
        switch self {
        case .speechPermission: "Allow Speech Recognition for this app in Settings → Privacy & Security to use dictation."
        case .microphonePermission: "Allow Microphone access for this app in Settings → Privacy & Security to use dictation."
        case .unavailable: "On-device dictation isn’t available for your current language. Check your iPhone’s language and dictation settings."
        case .microphoneUnavailable: "The microphone isn’t available. Check your audio input and try again."
        case .interrupted: "Dictation was interrupted. Your words have been kept in the draft."
        }
    }
}
#endif
