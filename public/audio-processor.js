/**
 * An AudioWorkletProcessor for capturing and processing audio.
 *
 * This processor receives raw audio data (Float32Array), converts it to
 * 16-bit PCM format, encodes it as a Base64 string, and sends it back
 * to the main thread.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  /**
   * Converts a Float32Array to a Int16Array.
   * @param {Float32Array} buffer The float32 audio data.
   * @returns {Int16Array} The int16 audio data.
   */
  float32ToInt16(buffer) {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
      buf[l] = Math.min(1, buffer[l]) * 0x7fff;
    }
    return buf;
  }

  /**
   * Encodes a Int16Array into a Base64 string.
   * This is a simplified implementation.
   * @param {Int16Array} int16Array The int16 audio data.
   * @returns {string} The base64 encoded audio data.
   */
  toBase64(int16Array) {
    const CHUNK_SIZE = 0x8000;
    let index = 0;
    const length = int16Array.length;
    let result = '';
    let slice;
    while (index < length) {
      slice = int16Array.subarray(index, Math.min(index + CHUNK_SIZE, length));
      result += String.fromCharCode.apply(null, slice);
      index += CHUNK_SIZE;
    }
    // btoa is not available in worklets in all browsers, but it is in modern ones for this context.
    return btoa(result);
  }

  process(inputs, outputs, parameters) {
    // We only expect one input.
    const input = inputs[0];

    // And the input should have at least one channel.
    if (input.length > 0) {
      const pcm16 = this.float32ToInt16(input[0]);
      if (pcm16.buffer.byteLength > 0) {
        const base64 = this.toBase64(pcm16);
        this.port.postMessage({ audioData: base64 });
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
