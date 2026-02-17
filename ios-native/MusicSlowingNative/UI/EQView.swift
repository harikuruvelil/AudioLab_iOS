import SwiftUI

struct EQView: View {
    @ObservedObject var audioManager: AudioEngineManager

    private let labels = ["100", "250", "1k", "4k", "10k"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("EQ")
                    .font(.headline)
                Spacer()
                Toggle("Enabled", isOn: Binding(
                    get: { audioManager.eqEnabled },
                    set: { audioManager.setEQEnabled($0) }
                ))
                .labelsHidden()
            }

            Picker("Preset", selection: Binding(
                get: { audioManager.eqPresetName },
                set: { audioManager.applyEQPreset($0) }
            )) {
                ForEach(EQPresetName.allCases, id: \.self) { preset in
                    Text(preset.rawValue).tag(preset)
                }
            }
            .pickerStyle(.segmented)

            HStack(alignment: .bottom, spacing: 12) {
                ForEach(labels.indices, id: \.self) { index in
                    VerticalEQFader(
                        label: labels[index],
                        value: Binding(
                            get: { audioManager.eqBandGains[index] },
                            set: { audioManager.setEQBandGain(index: index, gain: $0) }
                        )
                    )
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
            .opacity(audioManager.eqEnabled ? 1.0 : 0.55)
        }
        .padding()
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct VerticalEQFader: View {
    let label: String
    @Binding var value: Float

    var body: some View {
        VStack(spacing: 6) {
            Text(String(format: "%+.1f dB", value))
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)

            Slider(
                value: Binding(
                    get: { Double(value) },
                    set: { value = Float($0) }
                ),
                in: -12...12,
                step: 0.5
            )
            .rotationEffect(.degrees(-90))
            .frame(width: 120, height: 34)
            .padding(.vertical, 30)

            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}