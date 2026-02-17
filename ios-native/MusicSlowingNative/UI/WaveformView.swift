import SwiftUI

struct WaveformView: View {
    let frame: WaveformFrame
    let mode: WaveformMode
    let enabled: Bool
    let isPlaying: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.04))

            if enabled {
                Canvas { context, size in
                    let left = frame.left
                    let right = frame.right
                    guard !left.isEmpty else { return }

                    switch mode {
                    case .linear:
                        drawLinear(left: left, right: right, context: &context, size: size)
                    case .circular:
                        drawCircular(left: left, right: right, context: &context, size: size)
                    case .vectorscope:
                        drawVectorscope(left: left, right: right, isMono: frame.isMono, context: &context, size: size)
                    }
                }
                .drawingGroup(opaque: false, colorMode: .linear)
            } else {
                Text("Waveform Off")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if enabled, mode == .vectorscope, frame.isMono {
                VStack {
                    HStack {
                        Spacer()
                        Text("Mono (vectorscope limited)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(6)
                            .background(Color.black.opacity(0.35), in: Capsule())
                    }
                    Spacer()
                }
                .padding(8)
            }

            if enabled, !isPlaying {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.black.opacity(0.35))
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func drawLinear(left: [Float], right: [Float], context: inout GraphicsContext, size: CGSize) {
        let centerY = size.height / 2
        let width = size.width
        let points = left.count

        var path = Path()
        for i in 0..<points {
            let x = CGFloat(i) / CGFloat(max(points - 1, 1)) * width
            let y = centerY - CGFloat(left[i]) * (size.height * 0.42)
            if i == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }

        let glow = GraphicsContext.Shading.color(Color.cyan.opacity(0.15))
        context.stroke(path, with: glow, lineWidth: 4)
        context.stroke(path, with: .color(.cyan), lineWidth: 1.25)

        if !right.isEmpty {
            var rightPath = Path()
            for i in 0..<right.count {
                let x = CGFloat(i) / CGFloat(max(right.count - 1, 1)) * width
                let y = centerY - CGFloat(right[i]) * (size.height * 0.32)
                if i == 0 {
                    rightPath.move(to: CGPoint(x: x, y: y))
                } else {
                    rightPath.addLine(to: CGPoint(x: x, y: y))
                }
            }
            context.stroke(rightPath, with: .color(.mint.opacity(0.75)), lineWidth: 0.8)
        }
    }

    private func drawCircular(left: [Float], right: [Float], context: inout GraphicsContext, size: CGSize) {
        let cx = size.width / 2
        let cy = size.height / 2
        let radius = min(size.width, size.height) * 0.34
        let points = left.count

        var path = Path()
        for i in 0..<points {
            let phase = CGFloat(i) / CGFloat(max(points - 1, 1))
            let angle = phase * .pi * 2
            let sample = CGFloat((left[i] + (right.indices.contains(i) ? right[i] : left[i])) * 0.5)
            let r = radius + sample * 18
            let x = cx + cos(angle) * r
            let y = cy + sin(angle) * r
            if i == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }
        path.closeSubpath()

        context.stroke(path, with: .color(.cyan), lineWidth: 1.2)
    }

    private func drawVectorscope(left: [Float], right: [Float], isMono: Bool, context: inout GraphicsContext, size: CGSize) {
        let cx = size.width / 2
        let cy = size.height / 2
        let scale = min(size.width, size.height) * 0.45

        if isMono {
            var monoLine = Path()
            monoLine.move(to: CGPoint(x: cx - scale, y: cy + scale))
            monoLine.addLine(to: CGPoint(x: cx + scale, y: cy - scale))
            context.stroke(monoLine, with: .color(.orange.opacity(0.8)), lineWidth: 1)
        }

        var path = Path()
        let stride = max(1, left.count / 220)
        var first = true
        var i = 0
        while i < left.count, i < right.count {
            let x = cx + CGFloat(left[i]) * scale
            let y = cy - CGFloat(right[i]) * scale
            if first {
                path.move(to: CGPoint(x: x, y: y))
                first = false
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
            i += stride
        }

        context.stroke(path, with: .color(.mint), lineWidth: 1)
    }
}