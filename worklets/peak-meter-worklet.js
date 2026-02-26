class PeakMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maxPeak = 0;
    this.framesSinceReport = 0;
    this.reportIntervalFrames = Math.max(256, Math.round(sampleRate / 10));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    let frames = 128;

    if (input && input.length > 0) {
      frames = input[0]?.length ?? frames;

      for (let channel = 0; channel < input.length; channel += 1) {
        const inputChannel = input[channel];
        const outputChannel = output[channel];

        if (outputChannel) {
          outputChannel.set(inputChannel);
        }

        for (let i = 0; i < inputChannel.length; i += 1) {
          const peak = Math.abs(inputChannel[i]);
          if (peak > this.maxPeak) {
            this.maxPeak = peak;
          }
        }
      }

      for (let channel = input.length; channel < output.length; channel += 1) {
        output[channel].fill(0);
      }
    } else {
      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel].fill(0);
      }
    }

    this.framesSinceReport += frames;
    if (this.framesSinceReport >= this.reportIntervalFrames) {
      this.port.postMessage({ peak: this.maxPeak });
      this.framesSinceReport = 0;
      this.maxPeak = 0;
    }

    return true;
  }
}

registerProcessor("peak-meter-processor", PeakMeterProcessor);
