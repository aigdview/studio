class AudioProcessor extends AudioWorkletProcessor {
  float32ToInt16AndBase64(buffer) {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
      buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7FFF;
    }
    let binary = "";
    const bytes = new Uint8Array(buf.buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const channel = input[0];

    if (channel) {
      const audioData = this.float32ToInt16AndBase64(channel);
      this.port.postMessage({ audioData });
    }

    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
