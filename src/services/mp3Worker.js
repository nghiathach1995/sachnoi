// mp3Worker.js
// Web Worker to encode WAV to MP3 using lamejs in the background
// This allows utilizing multiple CPU cores for encoding without freezing the main UI thread.

// We use importScripts because lamejs might be loaded from CDN in index.html,
// but inside a worker we don't have access to the DOM's window object.
// So we fetch the CDN script directly in the worker.
self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js');

self.onmessage = function(e) {
  const { id, wavBuffer } = e.data;
  try {
    const mp3Buffer = encodeWavToMp3(wavBuffer);
    self.postMessage({ id, mp3Buffer }, [mp3Buffer.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

function encodeWavToMp3(wavBuffer) {
  const firstView  = new DataView(wavBuffer);
  const channels   = firstView.getUint16(22, true);   // 1=mono, 2=stereo
  const sampleRate = firstView.getUint32(24, true);   // e.g. 22050

  const encoder  = new self.lamejs.Mp3Encoder(channels, sampleRate, 128);
  const mp3Parts = [];
  const BLOCK    = 1152; // samples per MP3 frame

  let dataOffset = 44;
  try {
    const v = new DataView(wavBuffer);
    for (let off = 12; off < Math.min(wavBuffer.byteLength - 8, 200); ) {
      const id = String.fromCharCode(v.getUint8(off), v.getUint8(off+1), v.getUint8(off+2), v.getUint8(off+3));
      const sz = v.getUint32(off + 4, true);
      if (id === 'data') { dataOffset = off + 8; break; }
      off += 8 + sz;
    }
  } catch {}

  const pcm = new Int16Array(wavBuffer, dataOffset);

  for (let i = 0; i < pcm.length; i += BLOCK) {
    const slice = pcm.subarray(i, Math.min(i + BLOCK, pcm.length));

    let encoded;
    if (channels === 1) {
      encoded = encoder.encodeBuffer(slice);
    } else {
      const half  = Math.floor(slice.length / 2);
      const left  = new Int16Array(half);
      const right = new Int16Array(half);
      for (let j = 0; j < half; j++) {
        left[j]  = slice[j * 2];
        right[j] = slice[j * 2 + 1];
      }
      encoded = encoder.encodeBuffer(left, right);
    }
    if (encoded.length > 0) mp3Parts.push(encoded);
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) mp3Parts.push(flushed);

  const totalLen = mp3Parts.reduce((s, p) => s + p.length, 0);
  const merged   = new Uint8Array(totalLen);
  let off        = 0;
  for (const p of mp3Parts) { merged.set(p, off); off += p.length; }

  return merged;
}
