import SwiftUI

struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var audioManager: AudioEngineManager

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    ReverbView(audioManager: audioManager)
                    EQView(audioManager: audioManager)

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Waveform")
                            .font(.headline)

                        Toggle("Enabled", isOn: Binding(
                            get: { audioManager.waveformEnabled },
                            set: { audioManager.setWaveformEnabled($0) }
                        ))

                        Picker("Mode", selection: Binding(
                            get: { audioManager.waveformMode },
                            set: { audioManager.setWaveformMode($0) }
                        )) {
                            ForEach(WaveformMode.allCases, id: \.self) { mode in
                                Text(mode.label).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                        .disabled(!audioManager.waveformEnabled)
                    }
                    .padding()
                    .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
                }
                .padding()
                .padding(.bottom, 20)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .keyboardShortcut(.cancelAction)
                    .accessibilityLabel("Close settings")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}