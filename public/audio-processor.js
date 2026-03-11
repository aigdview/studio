"use strict";

class AudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      if (channelData) {
        const pcm16 = this.float32To16BitPCM(channelData);
        const base64 = this.pcm16ToBase64(pcm16);
        this.port.postMessage({ audioData: base64 });
      }
    }
    return true;
  }

  float32To16BitPCM(float32Array) {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  pcm16ToBase64(pcm16Array) {
    let binary = "";
    const bytes = new Uint8Array(pcm16Array.buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

try {
  registerProcessor("audio-processor", AudioProcessor);
} catch (e) {
  console.error("Failed to register audio-processor:", e);
}
