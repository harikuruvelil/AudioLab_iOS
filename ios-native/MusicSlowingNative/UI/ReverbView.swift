import SwiftUI
import UniformTypeIdentifiers

struct ReverbView: View {
    @ObservedObject var audioManager: AudioEngineManager

    @State private var showingImporter = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Reverb")
                    .font(.headline)
                Spacer()
                Toggle("Enabled", isOn: Binding(
                    get: { audioManager.reverbEnabled },
                    set: { audioManager.setReverbEnabled($0) }
                ))
                .labelsHidden()
            }

            Picker("Preset", selection: Binding(
                get: { audioManager.selectedIRPresetId },
                set: { audioManager.setIRPreset(id: $0) }
            )) {
                ForEach(audioManager.irPresets) { preset in
                    Text(preset.name).tag(preset.id)
                }
            }
            .pickerStyle(.menu)

            HStack {
                Button("Next Preset") {
                    audioManager.nextIRPreset()
                }
                .buttonStyle(.bordered)

                Spacer()

                Button("Import IR WAV") {
                    showingImporter = true
                }
                .buttonStyle(.bordered)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Wet: \(Int(audioManager.reverbWetPercent.rounded()))%")
                    .font(.subheadline.monospacedDigit())

                Slider(
                    value: Binding(
                        get: { audioManager.reverbWetPercent },
                        set: { audioManager.setReverbWetPercent($0) }
                    ),
                    in: 0...100,
                    step: 1
                )
            }
        }
        .padding()
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [UTType(filenameExtension: "wav") ?? .audio],
            allowsMultipleSelection: false
        ) { result in
            if case let .success(urls) = result, let first = urls.first {
                audioManager.importCustomIR(from: first)
            }
        }
    }
}