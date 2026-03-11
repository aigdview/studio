// public/audio-processor.js

// Custom Base64 implementation because btoa is not available in AudioWorkletGlobalScope
const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
const _btoa = (string) => {
    string = String(string);
    let bitmap, a, b, c,
        result = "",
        i = 0,
        rest = string.length % 3;

    for (; i < string.length;) {
        if ((a = string.charCodeAt(i++)) > 255 ||
            (b = string.charCodeAt(i++)) > 255 ||
            (c = string.charCodeAt(i++)) > 255)
            throw new TypeError("Failed to execute '_btoa': The string to be encoded contains characters outside of the Latin1 range.");

        bitmap = (a << 16) | (b << 8) | c;
        result += b64.charAt(bitmap >> 18 & 63) + b64.charAt(bitmap >> 12 & 63) +
            b64.charAt(bitmap >> 6 & 63) + b64.charAt(bitmap & 63);
    }

    return rest ? result.slice(0, rest - 3) + "===".substring(rest) : result;
};


class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    // The API expects audio chunks of 100ms.
    // With a sample rate of 16000, that is 1600 samples.
    this.bufferSize = 1600;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const pcmData = input[0];
      this.buffer.push(...pcmData);

      while (this.buffer.length >= this.bufferSize) {
        const chunk = this.buffer.splice(0, this.bufferSize);
        const base64Data = this.pcmToBase64(chunk);
        this.port.postMessage({ audioData: base64Data });
      }
    }
    return true;
  }

  pcmToBase64(pcmData) {
    // Convert float32 PCM to 16-bit PCM
    const pcm16i = new Int16Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      let s = Math.max(-1, Math.min(1, pcmData[i]));
      pcm16i[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Convert to a string of binary characters
    let byteChars = "";
    for (let i = 0; i < pcm16i.length; i++) {
      byteChars += String.fromCharCode(pcm16i[i] & 0xff);
      byteChars += String.fromCharCode((pcm16i[i] >> 8) & 0xff);
    }

    // Base64 encode the binary string using our custom implementation
    return _btoa(byteChars);
  }
}

registerProcessor("audio-processor", AudioProcessor);
