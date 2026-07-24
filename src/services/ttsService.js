// Import removed: using window.lamejs from CDN in index.html to avoid "MPEGMode is not defined" error in Vite strict mode
import { get, set, del } from 'idb-keyval';

class TTSService {
  constructor() {
    this.synth = window.speechSynthesis;
    this.chunks = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.voice = null;
    this.rate = 1;
    this.pitch = 1;
    this.onProgress = null;
    this.onStateChange = null;
    this.currentAudio = null;
    this.prefetchCache = new Map();

    this.fallbackVoices = [
      { voiceURI: 'sv-nu-bac',  name: 'VN Giong Nu - Mien Bac',  lang: 'vi-VN', isFallback: true, pitch: 1.4, rateBoost: 1.0  },
      { voiceURI: 'sv-nam-bac', name: 'VN Giong Nam - Mien Bac', lang: 'vi-VN', isFallback: true, pitch: 0.6, rateBoost: 0.95 },
      { voiceURI: 'sv-nu-nam',  name: 'VN Giong Nu - Mien Nam',  lang: 'vi-VN', isFallback: true, pitch: 1.2, rateBoost: 1.0  },
      { voiceURI: 'sv-nam-nam', name: 'VN Giong Nam - Mien Nam', lang: 'vi-VN', isFallback: true, pitch: 0.4, rateBoost: 0.95 },
      { voiceURI: 'vi-VN-HoaiMyNeural', name: 'Microsoft Hoài My Online (Natural) - Vietnamese (Vietnam)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 },
      { voiceURI: 'vi-VN-NamMinhNeural', name: 'Microsoft Nam Minh Online (Natural) - Vietnamese (Vietnam)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 },
      { voiceURI: 'Phạm Tuyên', name: 'VieNeu Phạm Tuyên (Local AI - Nam Bắc)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 },
      { voiceURI: 'Minh Đức', name: 'VieNeu Minh Đức (Local AI - Nam Bắc)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 },
      { voiceURI: 'Thanh Bình', name: 'VieNeu Thanh Bình (Local AI - Nam Bắc)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 },
      { voiceURI: 'Trúc Ly', name: 'VieNeu Trúc Ly (Local AI - Nữ Bắc)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 },
      { voiceURI: 'Mai Anh', name: 'VieNeu Mai Anh (Local AI - Nữ Bắc)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 }
    ];
    this.fallbackVoice = this.fallbackVoices[0];
  }

  // ─── Voices ────────────────────────────────────────────────────────────────

  getVoices() {
    return new Promise((resolve) => {
      let voices = this.synth.getVoices();
      if (voices.length > 0) {
        resolve([...voices, ...this.fallbackVoices]);
      } else {
        this.synth.onvoiceschanged = () => {
          resolve([...this.synth.getVoices(), ...this.fallbackVoices]);
        };
        setTimeout(() => {
          if (this.synth.getVoices().length === 0) resolve([...this.fallbackVoices]);
        }, 1500);
      }
    });
  }

  setSettings(voiceURI, rate, pitch) {
    const fbMatch = this.fallbackVoices.find(v => v.voiceURI === voiceURI);
    if (fbMatch) {
      this.voice = fbMatch;
    } else {
      this.voice = this.synth.getVoices().find(v => v.voiceURI === voiceURI) || null;
    }
    this.rate = rate;
    this.pitch = pitch;
  }

  // ─── Chunking ──────────────────────────────────────────────────────────────

  chunkText(text) {
    const rawChunks = text
      .replace(/\r\n/g, '\n')
      .replace(/([.!?])\s+(?=[A-ZĐÁÀẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ])/g, '$1|SPLIT|')
      .replace(/\n+/g, '|SPLIT|')
      .split('|SPLIT|');
      
    return rawChunks
      .map(p => p.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim())
      .filter(p => p.length > 0);
  }

  splitParagraphForFallback(text, maxLen = 170) {
    const sentenceRe = /[^.!?.]+[.!?.]+/g;
    const sentences = text.match(sentenceRe) || [];
    const rest = text.replace(sentenceRe, '').trim();
    if (rest) sentences.push(rest);

    const subChunks = [];
    let buffer = '';

    for (const s of sentences) {
      const trimmed = s.trim();
      if ((buffer + ' ' + trimmed).trim().length <= maxLen) {
        buffer = (buffer + ' ' + trimmed).trim();
      } else {
        if (buffer) subChunks.push(buffer);
        if (trimmed.length > maxLen) {
          const words = trimmed.split(/\s+/);
          let wb = '';
          for (const w of words) {
            if ((wb + ' ' + w).trim().length > maxLen) {
              if (wb) subChunks.push(wb.trim());
              wb = w;
            } else {
              wb = (wb + ' ' + w).trim();
            }
          }
          buffer = wb;
        } else {
          buffer = trimmed;
        }
      }
    }
    if (buffer) subChunks.push(buffer);
    return subChunks.filter(c => c.length > 0);
  }

  // ─── Public playback ────────────────────────────────────────────────────────

  loadText(text) {
    this.stop();
    this.chunks = this.chunkText(text);
    this.currentIndex = 0;
    if (this.onProgress) this.onProgress(0, this.chunks.length);
  }

  play() {
    if (this.chunks.length === 0 || this.isPlaying) return;
    if (this.currentIndex >= this.chunks.length) this.currentIndex = 0;
    this.isPlaying = true;
    this.notifyState();
    this._speakCurrent();
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.voice?.isFallback) {
      this.currentAudio?.pause();
    } else {
      this.synth.pause();
    }
    this.notifyState();
  }

  resume() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.notifyState();
    if (this.voice?.isFallback) {
      if (this.currentAudio?.paused) this.currentAudio.play();
      else this._speakCurrent();
    } else {
      if (this.synth.paused) this.synth.resume();
      else this._speakCurrent();
    }
  }

  stop() {
    this.isPlaying = false;
    this.currentIndex = 0;
    this._cancelCurrent();
    this.notifyState();
    if (this.onProgress) this.onProgress(0, this.chunks.length);
  }

  next() {
    if (this.currentIndex < this.chunks.length - 1) {
      this._cancelCurrent();
      this.currentIndex++;
      if (this.isPlaying) this._speakCurrent();
      else if (this.onProgress) this.onProgress(this.currentIndex, this.chunks.length);
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this._cancelCurrent();
      this.currentIndex--;
      if (this.isPlaying) this._speakCurrent();
      else if (this.onProgress) this.onProgress(this.currentIndex, this.chunks.length);
    }
  }

  seek(index) {
    if (index >= 0 && index < this.chunks.length) {
      this._cancelCurrent();
      this.currentIndex = index;
      if (this.isPlaying) this._speakCurrent();
      else if (this.onProgress) this.onProgress(this.currentIndex, this.chunks.length);
    }
  }

  _cancelCurrent() {
    if (this.currentAudio) {
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.synth.cancel();
    this.prefetchCache.clear(); // Clear prefetch cache when manually skipping or seeking
  }

  _speakCurrent() {
    if (this.currentIndex >= this.chunks.length) {
      this.isPlaying = false;
      this.notifyState();
      return;
    }
    if (this.onProgress) this.onProgress(this.currentIndex, this.chunks.length);
    
    // Fire background prefetch for the NEXT chunk
    if (this.currentIndex + 1 < this.chunks.length && this.voice?.isFallback) {
       this._getPrefetchPromises(this.currentIndex + 1);
    }
    
    if (this.voice?.isFallback) {
      this._speakEdgeTTSBackend(this.currentIndex, () => this._onChunkDone());
    } else {
      this._speakWebSpeech(this.chunks[this.currentIndex], () => this._onChunkDone());
    }
  }

  _onChunkDone() {
    if (!this.isPlaying) return;
    this.currentIndex++;
    if (this.currentIndex < this.chunks.length) {
      setTimeout(() => {
        if (this.isPlaying) this._speakCurrent();
      }, 700); // 700ms pause between sentences/paragraphs
    } else {
      this.isPlaying = false;
      this.notifyState();
    }
  }

  _speakWebSpeech(paragraphText, onDone) {
    const MAX = 800;
    const subChunks = paragraphText.length <= MAX
      ? [paragraphText]
      : this.splitParagraphForFallback(paragraphText, MAX);

    let idx = 0;
    const next = () => {
      if (!this.isPlaying || idx >= subChunks.length) { onDone(); return; }
      const utt = new SpeechSynthesisUtterance(subChunks[idx]);
      if (this.voice) utt.voice = this.voice;
      utt.rate  = this.rate;
      utt.pitch = this.pitch;
      utt.onend   = () => { idx++; next(); };
      utt.onerror = (e) => { console.error('SpeechSynthesisUtterance error:', e); onDone(); };
      this.synth.speak(utt);
    };
    next();
  }

  _getPrefetchPromises(index) {
    if (this.prefetchCache.has(index)) {
      return this.prefetchCache.get(index);
    }
    const paragraphText = this.chunks[index];
    const voiceName = this._getSAPIVoiceName();
    const vieneuVoices = ['Phạm Tuyên', 'Minh Đức', 'Thanh Bình', 'Trúc Ly', 'Mai Anh'];
    const isVieneu = vieneuVoices.includes(voiceName);

    const MAX = isVieneu ? 250 : 800; 
    const subChunks = paragraphText.length <= MAX
      ? [paragraphText]
      : this.splitParagraphForFallback(paragraphText, MAX);
    
    const fetchPromises = subChunks.map(text => 
      fetch(isVieneu ? '/offline/vieneu' : '/offline/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceName, rate: this.rate }),
      }).then(async r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (!data.audioBase64) throw new Error('Empty audio');
        return data;
      }).catch(err => {
        console.error('Prefetch error', err);
        return null;
      })
    );
    this.prefetchCache.set(index, { subChunks, fetchPromises });
    return this.prefetchCache.get(index);
  }

  async _speakEdgeTTSBackend(index, onDone) {
    if (!this.isPlaying) { onDone(); return; }
    
    const { subChunks, fetchPromises } = this._getPrefetchPromises(index);
    // Cleanup cache to avoid memory leaks
    this.prefetchCache.delete(index);

    let idx = 0;

    const next = async () => {
      if (!this.isPlaying || idx >= subChunks.length) { onDone(); return; }
      
      try {
        // Chỉ việc đợi kết quả đã tải sẵn
        const data = await fetchPromises[idx];
        
        // Parse VTT to get cues array: [{ start: 0.1, end: 0.5, word: 'Ngày' }, ...]
        let cues = [];
        if (data.vtt) {
          const lines = data.vtt.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('-->')) {
              const times = line.split('-->').map(t => t.trim());
              const parseTime = (t) => {
                const [hms, ms] = t.split('.');
                const [h, m, s] = hms.split(':').map(Number);
                return h * 3600 + m * 60 + s + (ms ? Number(ms) / 1000 : 0);
              };
              if (times.length === 2 && i + 1 < lines.length) {
                cues.push({
                  start: parseTime(times[0]),
                  end: parseTime(times[1]),
                  word: lines[i+1].trim()
                });
              }
            }
          }
        }
        
        const isWav = data.audioBase64.startsWith('UklGR');
        const mime = isWav ? 'audio/wav' : 'audio/mp3';
        const audio = new Audio(`data:${mime};base64,` + data.audioBase64);
        this.currentAudio = audio;
        
        // Time update for Karaoke Mode
        if (cues.length > 0) {
          audio.ontimeupdate = () => {
            const t = audio.currentTime;
            const currentCue = cues.find(c => t >= c.start && t <= c.end);
            if (currentCue && this.onKaraokeCue) {
              this.onKaraokeCue(currentCue.word);
            }
          };
        }
        
        audio.onended = () => {
          this.currentAudio = null;
          if (this.onKaraokeCue) this.onKaraokeCue(''); // clear highlight
          idx++;
          next();
        };
        audio.onerror = (e) => {
          console.error('Audio playback error', e);
          this.currentAudio = null;
          if (this.onKaraokeCue) this.onKaraokeCue('');
          idx++;
          next(); 
        };
        
        await audio.play();
      } catch (err) {
        console.error('EdgeTTS backend play error:', err);
        idx++;
        next();
      }
    };
    
    next();
  }

  notifyState() {
    if (this.onStateChange) this.onStateChange(this.isPlaying);
  }

  // ─── Download Audio ─────────────────────────────────────────────────────────

  // Cancel current download
  cancelDownload() {
    this._downloadCancelled = true;
  }

  async downloadAudio(text, mode = 'online', fileName = 'audio.mp3', onProgress = null, silenceDuration = 0, exportSrt = false, onStatus = null) {
    this._downloadCancelled = false;
    if (mode === 'offline') {
      return this._downloadOfflineSAPI(text, fileName, onProgress, silenceDuration, exportSrt, onStatus);
    } else if (mode === 'vieneu') {
      return this._downloadOfflineVieneu(text, fileName, onProgress, silenceDuration, exportSrt, onStatus);
    } else {
      return this._downloadOnline(text, fileName, onProgress);
    }
  }

  // Stable hash for cache keys (so key doesn't change if split size changes)
  _hashText(str) {
    let hash = 0;
    for (let i = 0; i < Math.min(str.length, 200); i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  // ── Vieneu (Local AI) ──────────────────────────────────────────────────────
  async _downloadOfflineVieneu(text, fileName, onProgress, silenceDuration = 0, exportSrt = false, onStatus = null) {
    let voiceName = this._getSAPIVoiceName();
    
    // Auto fallback if user forgot to select a VieNeu voice
    const vieneuVoices = ['Phạm Tuyên', 'Minh Đức', 'Thanh Bình', 'Trúc Ly', 'Mai Anh'];
    if (!vieneuVoices.includes(voiceName)) {
      if (voiceName.toLowerCase().includes('hoai') || voiceName.toLowerCase().includes('nữ') || voiceName.toLowerCase().includes('female')) {
        voiceName = 'Mai Anh';
      } else {
        voiceName = 'Phạm Tuyên';
      }
    }

    const batches = this.splitParagraphForFallback(text, 250);
    const total = batches.length;
    let completed = 0;
    const results = new Array(total).fill(null);

    // Check how many are already cached
    let cachedCount = 0;
    for (let i = 0; i < total; i++) {
      const cacheKey = `vn-${this._hashText(batches[i])}-${voiceName}`;
      try {
        const cached = await get(cacheKey);
        if (cached && cached.audioBuf) cachedCount++;
      } catch(e) {}
    }
    if (cachedCount > 0) {
      onStatus && onStatus(`resume:${cachedCount}/${total}`);
    }

    const synthesizeVieneu = async (batchText, idx) => {
      // Stable cache key based on content hash, not index
      const cacheKey = `vn-${this._hashText(batchText)}-${voiceName}`;
      try {
        const cached = await get(cacheKey);
        if (cached && cached.audioBuf) return { ...cached, fromCache: true };
      } catch(e) {}

      if (this._downloadCancelled) return null;

      for (let attempt = 0; attempt < 3; attempt++) {
        if (this._downloadCancelled) return null;
        try {
          const resp = await fetch('/offline/vieneu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: batchText, voiceName })
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const data = await resp.json();
          if (!data.audioBase64) throw new Error('Empty audioBase64 from Vieneu');
          
          const binary = atob(data.audioBase64);
          const buf = new Uint8Array(binary.length);
          for(let i=0; i<binary.length; i++) buf[i] = binary.charCodeAt(i);
          
          const result = { audioBuf: buf, originalText: batchText };
          await set(cacheKey, result).catch(()=>({}));
          return result;
        } catch(e) {
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
          else console.warn(`[Vieneu] Skip batch ${idx}: ${e.message}`);
        }
      }
      return null;
    };

    let skipped = 0;
    const CONCURRENCY = 3;
    let currentIndex = 0;

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        if (this._downloadCancelled) break;
        const i = currentIndex++;
        if (i >= total) break;
        const res = await synthesizeVieneu(batches[i], i);
        results[i] = res;
        if (!res) skipped++;
        completed++;
        onProgress && onProgress(Math.round((completed / total) * 95));
      }
    });

    await Promise.all(workers);

    if (this._downloadCancelled) {
      throw new Error('Đã huỷ tải xuống.');
    }

    const validResults = results.filter(Boolean);
    if (validResults.length === 0) {
      throw new Error('Vieneu synthesis failed (all chunks skipped).');
    }

    // Merge WAV buffers using Blob parts (memory efficient)
    const buffers = validResults.map(r => r.audioBuf);
    
    // Create silence buffer (WAV PCM 16-bit 48000Hz mono = 96000 bytes/sec)
    const bytesPerSec = 48000 * 2; 
    const silenceLen = Math.floor(bytesPerSec * silenceDuration);
    const silenceBuf = new Uint8Array(silenceLen);

    let totalDataLen = 0;
    const blobParts = [];
    const headerBuf = new Uint8Array(44);
    blobParts.push(headerBuf);

    for (let i = 0; i < buffers.length; i++) {
      const data = buffers[i].slice(44);
      totalDataLen += data.length;
      blobParts.push(data);
      if (i < buffers.length - 1 && silenceDuration > 0) {
        totalDataLen += silenceLen;
        blobParts.push(silenceBuf);
      }
    }
    
    headerBuf.set(buffers[0].slice(0, 44), 0);
    const view = new DataView(headerBuf.buffer);
    view.setUint32(4, 36 + totalDataLen, true);
    view.setUint32(40, totalDataLen, true);
    
    const blob = new Blob(blobParts, { type: 'audio/wav' });
    const outName = fileName.replace(/\.[^.]+$/, '.wav');
    this._triggerDownload(blob, outName);

    // Only clear cache AFTER successful download+trigger
    // Do NOT clear Vieneu cache - keep it for resume if browser fails to save
    onProgress && onProgress(100);
  }

  // ── SAPI (Edge-TTS Offline) ────────────────────────────────────────────────
  async _downloadOfflineSAPI(text, fileName, onProgress, silenceDuration = 0, exportSrt = false, onStatus = null) {
    const voiceName = this._getSAPIVoiceName();
    const rate      = this.rate;

    // Use chunks directly to preserve semantic pauses (paragraphs/sentences)
    const batches = this.splitParagraphForFallback(text, 5000);
    const total = batches.length;

    const CONCURRENCY = 1; // Sequential to avoid rate limiting from Microsoft Edge TTS
    const DELAY_BETWEEN_MS = 1000; // Increased to 1000ms to be safer against Microsoft bans
    console.log(`[EdgeTTS-offline] Tong hop: ${total} batch. Song song: ${CONCURRENCY} luong (sequential). Silence: ${silenceDuration}s. SRT: ${exportSrt}`);

    let completed = 0;
    const results = new Array(total).fill(null);

    // Check how many chunks are already cached (for resume UI)
    let cachedCount = 0;
    for (let i = 0; i < total; i++) {
      const cacheKey = `sapi-${this._hashText(batches[i])}-${voiceName}`;
      try {
        const cached = await get(cacheKey);
        if (cached && cached.audioBuf) cachedCount++;
      } catch(e) {}
    }
    if (cachedCount > 0) {
      onStatus && onStatus(`resume:${cachedCount}/${total}`);
    }

    const synthesizeMp3 = async (batchText, idx) => {
      // Use stable content-based cache key (survives F5 and file re-select)
      const cacheKey = `sapi-${this._hashText(batchText)}-${voiceName}`;
      
      // 1. Check cache (Resume)
      try {
        const cached = await get(cacheKey);
        if (cached && cached.audioBuf) {
          return { ...cached, fromCache: true };
        }
      } catch (e) {
        console.warn(`[EdgeTTS] Loi doc cache chunk ${idx}`, e);
      }

      if (this._downloadCancelled) return null;

      // 2. Fetch new
      for (let attempt = 0; attempt < 4; attempt++) {
        if (this._downloadCancelled) return null;
        try {
          const resp = await fetch('/offline/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: batchText, voiceName, rate }),
          });
          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}));
            throw new Error(errBody.error || 'HTTP ' + resp.status);
          }
          const data = await resp.json();
          if (!data.audioBase64 || data.audioBase64.length < 10) throw new Error('Empty audioBase64');
          
          const binary = atob(data.audioBase64);
          const buf = new Uint8Array(binary.length);
          for(let i=0; i<binary.length; i++) buf[i] = binary.charCodeAt(i);
          
          const result = { audioBuf: buf, vttText: data.vtt || '', originalText: batchText };
          
          // Cache it
          try {
            await set(cacheKey, result);
          } catch(e) {}
          
          return result;
        } catch (err) {
          if (attempt === 3) {
            console.warn(`[EdgeTTS] Bo qua batch ${idx}: ${err.message}`);
          } else {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      }
      return null;
    };

    let skippedCount = 0;
    let consecutiveFails = 0;

    let queueIdx = 0;
    const workerPipeline = async (workerIdx) => {
      await new Promise(r => setTimeout(r, workerIdx * 200));
      while (queueIdx < total) {
        if (this._downloadCancelled) break;
        if (consecutiveFails >= 3) {
          throw new Error('Microsoft Edge TTS đã chặn kết nối hoặc báo lỗi liên tục. Vui lòng giảm tốc độ tải hoặc thử lại sau (do tải quá nhiều).');
        }
        const i = queueIdx++;
        const res = await synthesizeMp3(batches[i], i);
        results[i] = res;
        if (!res) {
          skippedCount++;
          consecutiveFails++; // Only real network failures count
        } else {
          consecutiveFails = 0; // Reset on any success (cached or fresh)
        }
        completed++;
        const pct = Math.round((completed / total) * 93);
        onProgress && onProgress(pct);
        // Skip delay when chunk came from cache (no need to throttle)
        if (queueIdx < total && res && !res.fromCache) {
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, (_, idx) => workerPipeline(idx)));

    if (this._downloadCancelled) {
      throw new Error('Đã huỷ tải xuống.');
    }


    const validResults = results.filter(Boolean);
    const skipRate = skippedCount / total;
    console.log(`[EdgeTTS-offline] Hoan thanh: ${validResults.length}/${total} batch thanh cong, ${skippedCount} bi bo qua (${(skipRate*100).toFixed(1)}%)`);
    
    if (validResults.length === 0) {
      throw new Error(
        'Khong the tong hop am thanh. Kiem tra:\n' +
        '- Ket noi internet (edge-tts can internet)\n' +
        '- Python va edge-tts da cai dat dung cach\n' +
        '- Vite dev server dang chay'
      );
    }
    
    if (skipRate > 0.15) {
      throw new Error(
        `Tong hop that bai: ${skippedCount}/${total} doan bi loi (${(skipRate*100).toFixed(0)}%).\n` +
        'Co the do ket noi internet khong on dinh. Hay thu lai sau.'
      );
    }

    onProgress && onProgress(98);

    onProgress && onProgress(98);
    // Chuan bi Silence Buffer (Mặc định 700ms giữa các chunks, hoặc theo tùy chọn của user)
    const pauseMs = silenceDuration > 0 ? silenceDuration * 1000 : 700;
    
    // Tạo 1 giây silence buffer chuẩn
    const b64 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV";
    const bin = atob(b64);
    const oneSecSilence = new Uint8Array(bin.length);
    for(let i=0; i<bin.length; i++) oneSecSilence[i] = bin.charCodeAt(i);
    
    // Tính toán độ lớn buffer cho pauseMs
    const byteRate = oneSecSilence.length;
    const silenceBufLength = Math.floor(byteRate * (pauseMs / 1000));
    const silenceBuf = new Uint8Array(silenceBufLength);
    let offsetS = 0;
    while(offsetS < silenceBufLength) {
      const chunk = oneSecSilence.subarray(0, Math.min(oneSecSilence.length, silenceBufLength - offsetS));
      silenceBuf.set(chunk, offsetS);
      offsetS += chunk.length;
    }

    const blobParts = [];
    
    let srtContent = "";
    let srtIndex = 1;
    let currentOffsetMs = 0;

    for (let i = 0; i < validResults.length; i++) {
      const res = validResults[i];
      blobParts.push(res.audioBuf);
      
      let chunkDurationMs = 0;
      if (exportSrt) {
        chunkDurationMs = Math.round((res.audioBuf.length / 32000) * 1000); // estimate
        if (res.vttText) {
          const matches = [...res.vttText.matchAll(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g)];
          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            chunkDurationMs = (parseInt(lastMatch[1])*3600000) + (parseInt(lastMatch[2])*60000) + (parseInt(lastMatch[3])*1000) + parseInt(lastMatch[4]);
          }
        }
        
        const startTimeStr = this._msToSrtTime(currentOffsetMs);
        const endTimeStr = this._msToSrtTime(currentOffsetMs + chunkDurationMs);
        
        srtContent += `${srtIndex}\n${startTimeStr} --> ${endTimeStr}\n${res.originalText}\n\n`;
        srtIndex++;
      }
      currentOffsetMs += chunkDurationMs;

      if (i < validResults.length - 1) {
        if (silenceDuration > 0) blobParts.push(silenceBuf);
        currentOffsetMs += pauseMs;
      }
    }

    const blob = new Blob(blobParts, { type: 'audio/mpeg' });
    const outName = fileName.replace(/\.[^.]+$/, '.mp3');
    this._triggerDownload(blob, outName);
    
    if (exportSrt && srtContent) {
      const srtBlob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
      const srtOutName = fileName.replace(/\.[^.]+$/, '.srt');
      this._triggerDownload(srtBlob, srtOutName);
    }

    // Dọn dẹp cache sau khi tải thành công
    for (let i = 0; i < total; i++) {
      del(`chunk-cache-${fileName}-${i}`).catch(()=>({}));
    }

    onProgress && onProgress(100);
    console.log('[EdgeTTS-offline] Hoan thanh 100%! MP3 size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
  }

  _msToSrtTime(msTotal) {
    const h = Math.floor(msTotal / 3600000).toString().padStart(2, '0');
    const m = Math.floor((msTotal % 3600000) / 60000).toString().padStart(2, '0');
    const s = Math.floor((msTotal % 60000) / 1000).toString().padStart(2, '0');
    const ms = (msTotal % 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
  }


  /**
   * Tra ve edge-tts voice ID chinh xac dua tren giong dang chon.
   * Tranh hoan toan string-matching o middleware.
   */
  _getSAPIVoiceName() {
    // Fallback profiles map
    if (!this.voice || this.voice.isFallback) {
      const uri = this.voice ? this.voice.voiceURI : '';
      if (['vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural', 'Phạm Tuyên', 'Minh Đức', 'Thanh Bình', 'Trúc Ly', 'Mai Anh'].includes(uri)) return uri;
      
      // fallback voices: sv-nu-bac, sv-nu-nam => female, sv-nam-bac, sv-nam-nam => male
      if (uri.includes('nu')) return 'vi-VN-HoaiMyNeural';
      if (uri.includes('nam')) return 'vi-VN-NamMinhNeural';
      return 'vi-VN-HoaiMyNeural'; // default female
    }

    const name = (this.voice.name || '').toLowerCase();
    
    // Log de debug
    console.log('[TTS] _getSAPIVoiceName input:', this.voice.name);

    // Uu tien kiem tra "hoai" truoc (gion nu Hoai My)
    if (name.includes('hoai')) return 'vi-VN-HoaiMyNeural';

    // Kiem tra "nam minh" chinh xac (gion nam)
    if (name.includes('nam minh') || name.includes('namminh') || name.includes('minh')) {
      return 'vi-VN-NamMinhNeural';
    }

    // Kiem tra theo lang va gender neu co
    if (this.voice.lang && this.voice.lang.startsWith('vi')) {
      // Co the dua vao gender neu Web Speech API cung cap
      const gender = (this.voice.gender || '').toLowerCase();
      if (gender === 'male') return 'vi-VN-NamMinhNeural';
      return 'vi-VN-HoaiMyNeural'; // mac dinh la female cho giong Viet
    }

    // Default
    return 'vi-VN-HoaiMyNeural';
  }


  // (Removed _encodeWavsToMp3: edge-tts now outputs MP3 directly)


  // ── ONLINE (Google TTS) ─────────────────────────────────────────────────────

  async _downloadOnline(chunks, fileName, onProgress) {
    const mp3Buffers = [];
    const MAX_BATCH  = 175;
    const DELAY_MS   = 500;
    const MAX_RETRY  = 2;
    let failCount    = 0;

    const allBatches = [];
    for (const chunk of chunks) {
      allBatches.push(...this.splitParagraphForFallback(chunk, MAX_BATCH));
    }
    const batches = allBatches;
    console.log('[TTS-online] ' + batches.length + ' batch');

    for (let i = 0; i < batches.length; i++) {
      onProgress && onProgress(Math.round((i / batches.length) * 90));

      const text = batches[i];
      const qs = new URLSearchParams({
        ie: 'UTF-8', client: 'tw-ob', q: text, tl: 'vi',
        total: '1', idx: '0', textlen: String(text.length),
      });
      const url = '/api/tts?' + qs.toString();

      let success = false;
      for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const buf = await resp.arrayBuffer();
          if (buf.byteLength < 50) throw new Error('Empty audio');
          mp3Buffers.push(new Uint8Array(buf));
          success = true;
          break;
        } catch {
          if (attempt < MAX_RETRY) {
            await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)));
          }
        }
      }
      if (!success) { failCount++; console.warn('[TTS-online] Bo qua batch ' + (i+1)); }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    if (mp3Buffers.length === 0) {
      throw new Error('Khong tai duoc audio tu Google TTS. Thu lai sau vai phut hoac dung che do Offline.');
    }

    onProgress && onProgress(95);
    
    // Tạo buffer silence 700ms
    const b64 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV";
    const bin = atob(b64);
    const oneSecSilence = new Uint8Array(bin.length);
    for(let i=0; i<bin.length; i++) oneSecSilence[i] = bin.charCodeAt(i);
    const silenceBufLength = Math.floor(oneSecSilence.length * 0.7);
    const silenceBuf = new Uint8Array(silenceBufLength);
    let offsetS = 0;
    while(offsetS < silenceBufLength) {
      const chunk = oneSecSilence.subarray(0, Math.min(oneSecSilence.length, silenceBufLength - offsetS));
      silenceBuf.set(chunk, offsetS);
      offsetS += chunk.length;
    }

    const blobParts = [];
    for (let i = 0; i < mp3Buffers.length; i++) {
      blobParts.push(mp3Buffers[i]);
      if (i < mp3Buffers.length - 1) blobParts.push(silenceBuf);
    }
    const blob    = new Blob(blobParts, { type: 'audio/mpeg' });
    const outName = fileName.replace(/\.[^.]+$/, '.mp3');
    this._triggerDownload(blob, outName);
    onProgress && onProgress(100);
    if (failCount > 0) console.warn('[TTS-online] ' + failCount + ' batch that bai.');
  }

  // ── Helper ─────────────────────────────────────────────────────────────────

  _triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

export default new TTSService();
