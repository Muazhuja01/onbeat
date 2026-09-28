/* global AudioWorkletProcessor, registerProcessor */
// Runs on the audio thread: collects microphone samples into chunks and posts
// them to the page, which resamples them to 16 kHz for the hearing worker.
const CHUNK = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CHUNK);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const n = Math.min(CHUNK - this.filled, channel.length - i);
      this.buffer.set(channel.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === CHUNK) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(CHUNK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("onbeat-capture", CaptureProcessor);
