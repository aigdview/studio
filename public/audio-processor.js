class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Using a buffer size of 2048 for demonstration.
    // This can be tuned for desired latency vs. network overhead.
    this.bufferSize = 2048;
    this._buffer = new Int16Array(this.bufferSize);
    this._bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0]; // Float32Array from -1.0 to 1.0

      for (let i = 0; i < channelData.length; i++) {
        // Convert to 16-bit PCM and store in buffer.
        this._buffer[this._bufferIndex++] = Math.max(-1, Math.min(1, channelData[i])) * 0x7FFF;

        if (this._bufferIndex === this.bufferSize) {
          // Buffer is full, send it.
          const pcmData = this._buffer.slice(0, this._bufferIndex);

          // Convert Int16Array to a byte string.
          let byteString = '';
          for (let j = 0; j < pcmData.length; j++) {
            byteString += String.fromCharCode(pcmData[j] & 0xff, (pcmData[j] >> 8) & 0xff);
          }

          // Base64 encode and post message to main thread.
          this.port.postMessage({ audioData: btoa(byteString) });

          // Reset buffer index.
          this._bufferIndex = 0;
        }
      }
    }
    // Keep the processor alive.
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
