// Import removed: using window.lamejs from CDN in index.html to avoid "MPEGMode is not defined" error in Vite strict mode

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

    this.fallbackVoices = [
      { voiceURI: 'sv-nu-bac',  name: 'VN Giong Nu - Mien Bac',  lang: 'vi-VN', isFallback: true, pitch: 1.4, rateBoost: 1.0  },
      { voiceURI: 'sv-nam-bac', name: 'VN Giong Nam - Mien Bac', lang: 'vi-VN', isFallback: true, pitch: 0.6, rateBoost: 0.95 },
      { voiceURI: 'sv-nu-nam',  name: 'VN Giong Nu - Mien Nam',  lang: 'vi-VN', isFallback: true, pitch: 1.2, rateBoost: 1.0  },
      { voiceURI: 'sv-nam-nam', name: 'VN Giong Nam - Mien Nam', lang: 'vi-VN', isFallback: true, pitch: 0.4, rateBoost: 0.95 },
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
    return text
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
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
  }

  _speakCurrent() {
    if (this.currentIndex >= this.chunks.length) {
      this.isPlaying = false;
      this.notifyState();
      return;
    }
    if (this.onProgress) this.onProgress(this.currentIndex, this.chunks.length);
    const text = this.chunks[this.currentIndex];
    if (this.voice?.isFallback) {
      this._speakWebSpeechFallback(text, () => this._onChunkDone());
    } else {
      this._speakWebSpeech(text, () => this._onChunkDone());
    }
  }

  _onChunkDone() {
    if (!this.isPlaying) return;
    this.currentIndex++;
    if (this.currentIndex < this.chunks.length) {
      this._speakCurrent();
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

  _speakWebSpeechFallback(paragraphText, onDone) {
    const MAX = 800;
    const subChunks = paragraphText.length <= MAX
      ? [paragraphText]
      : this.splitParagraphForFallback(paragraphText, MAX);

    const profile     = this.voice;
    const systemVoices = this.synth.getVoices();
    const isNu        = profile?.voiceURI?.includes('nu');
    const viVoices    = systemVoices.filter(v => (v.lang || '').startsWith('vi'));
    let bestVoice     = null;
    if (viVoices.length > 0) {
      bestVoice = isNu
        ? (viVoices.find(v => v.name.toLowerCase().includes('hoai') || v.name.toLowerCase().includes('my') || v.name.toLowerCase().includes('linh')) || viVoices[0])
        : (viVoices.find(v => v.name.toLowerCase().includes('nam')  || v.name.toLowerCase().includes('minh')) || viVoices[0]);
    }

    let idx = 0;
    const next = () => {
      if (!this.isPlaying || idx >= subChunks.length) { onDone(); return; }
      const utt = new SpeechSynthesisUtterance(subChunks[idx]);
      utt.lang  = 'vi-VN';
      if (bestVoice) utt.voice = bestVoice;
      utt.pitch  = profile?.pitch    ?? 1.0;
      utt.rate   = this.rate * (profile?.rateBoost ?? 1.0);
      utt.onend  = () => { idx++; next(); };
      utt.onerror = (e) => { console.error('TTS fallback error:', e); onDone(); };
      this.synth.speak(utt);
    };
    next();
  }

  notifyState() {
    if (this.onStateChange) this.onStateChange(this.isPlaying);
  }

  // ─── Download Audio ─────────────────────────────────────────────────────────

  async downloadAudio(text, mode, fileName, onProgress) {
    const chunks = this.chunkText(text);
    if (chunks.length === 0) throw new Error('Khong co noi dung de tai xuong.');

    if (mode === 'offline') {
      return this._downloadOfflineSAPI(chunks, fileName, onProgress);
    } else {
      return this._downloadOnline(chunks, fileName, onProgress);
    }
  }

  // ── OFFLINE (SAPI) ──────────────────────────────────────────────────────────
  // Phuong phap: goi Windows SAPI qua endpoint /offline/synthesize (Node/PowerShell)
  // - Xu ly song song theo so luong CPU de toi da toc do
  // - Tong hop am thanh WAV im lang, khong phat qua loa
  // - Lay MP3 truc tiep tu edge-tts backend (giong Viet Neural chinh xac)

  async _downloadOfflineSAPI(chunks, fileName, onProgress) {
    const voiceName = this._getSAPIVoiceName();
    const rate      = this.rate;

    const allText = chunks.join(' ');
    const batches = this.splitParagraphForFallback(allText, 175);
    const total   = batches.length;

    const concurrency = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
    console.log(`[EdgeTTS-offline] Tong hop: ${total} batch. Song song: ${concurrency} luong. Giong: ${voiceName}`);

    let completed = 0;
    const mp3Results = new Array(total).fill(null);

    // Ham goi backend edge-tts de lay MP3 truc tiep
    const synthesizeMp3 = async (text, idx) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const resp = await fetch('/offline/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voiceName, rate }),
          });
          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}));
            throw new Error(errBody.error || 'HTTP ' + resp.status);
          }
          const buf = await resp.arrayBuffer();
          if (buf.byteLength < 100) throw new Error('MP3 qua ngan');
          return new Uint8Array(buf);
        } catch (err) {
          if (attempt === 2) {
            console.warn(`[EdgeTTS] Bo qua batch ${idx}: ${err.message}`);
          } else {
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
      return null;
    };

    // Chay song song nhieu luong
    let queueIdx = 0;
    const workerPipeline = async () => {
      while (queueIdx < total) {
        const i = queueIdx++;
        const mp3Buf = await synthesizeMp3(batches[i], i);
        mp3Results[i] = mp3Buf;
        completed++;
        const pct = Math.round((completed / total) * 95);
        onProgress && onProgress(pct);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, workerPipeline));

    const validMp3s = mp3Results.filter(Boolean);
    if (validMp3s.length === 0) {
      throw new Error(
        'Khong the tong hop am thanh. Kiem tra:\n' +
        '- Ket noi internet (edge-tts can internet lan dau)\n' +
        '- Python va edge-tts da cai dat dung cach\n' +
        '- Vite dev server dang chay'
      );
    }

    onProgress && onProgress(98);

    // Ghep tat ca MP3 buffer thanh 1 file duy nhat
    const totalLength = validMp3s.reduce((sum, b) => sum + b.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of validMp3s) {
      merged.set(buf, offset);
      offset += buf.length;
    }

    const blob = new Blob([merged], { type: 'audio/mpeg' });
    const outName = fileName.replace(/\.[^.]+$/, '.mp3');
    this._triggerDownload(blob, outName);
    onProgress && onProgress(100);

    console.log('[EdgeTTS-offline] Hoan thanh 100%! MP3 size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
  }


  /**
   * Tra ve edge-tts voice ID chinh xac dua tren giong dang chon.
   * Tranh hoan toan string-matching o middleware.
   */
  _getSAPIVoiceName() {
    // Fallback profiles map
    if (!this.voice || this.voice.isFallback) {
      const uri = this.voice ? this.voice.voiceURI : '';
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

    const allText = chunks.join(' ');
    const batches  = this.splitParagraphForFallback(allText, MAX_BATCH);
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
    const totalLength = mp3Buffers.reduce((sum, b) => sum + b.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of mp3Buffers) { merged.set(buf, offset); offset += buf.length; }
    const blob    = new Blob([merged], { type: 'audio/mpeg' });
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
