/**
 * @file This script defines an AudioWorkletProcessor responsible for
 * capturing audio from the microphone, converting it to 16-bit PCM format,
 * encoding it in Base64, and sending it to the main thread.
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    // The Gemini API prefers audio chunks of around 100ms.
    // At a 16000Hz sample rate, 100ms is 1600 samples.
    // We'll buffer a bit more to be safe and process in chunks of 2048.
    this.bufferSize = 2048;
  }

  /**
   * Called by the browser's audio engine to process audio data.
   * @param {Float32Array[][]} inputs - An array of inputs, each containing an array of channels.
   * @returns {boolean} - Returns true to keep the processor alive.
   */
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      if (channelData) {
        this.buffer.push(...channelData);
      }

      // Process the buffer when it has enough data.
      while (this.buffer.length >= this.bufferSize) {
        const chunk = this.buffer.splice(0, this.bufferSize);
        const pcm16 = this.floatTo16BitPCM(chunk);
        const base64 = this.pcmToBase64(pcm16);
        this.port.postMessage({ audioData: base64 });
      }
    }
    return true; // Keep the processor alive.
  }

  /**
   * Converts a Float32Array to a 16-bit PCM Int16Array.
   * @param {Float32Array} input - The float audio data.
   * @returns {Int16Array} - The 16-bit PCM audio data.
   */
  floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  }

  /**
   * Encodes a 16-bit PCM Int16Array into a Base64 string.
   * @param {Int16Array} pcm16 - The 16-bit PCM audio data.
   * @returns {string} - The Base64 encoded audio data.
   */
  pcmToBase64(pcm16) {
    const buffer = pcm16.buffer;
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

// Register the processor with the name 'audio-processor'.
// This name must match the name used when creating the AudioWorkletNode.
registerProcessor('audio-processor', AudioProcessor);
