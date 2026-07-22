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
    this.prefetchCache = new Map();

    this.fallbackVoices = [
      { voiceURI: 'sv-nu-bac',  name: 'VN Giong Nu - Mien Bac',  lang: 'vi-VN', isFallback: true, pitch: 1.4, rateBoost: 1.0  },
      { voiceURI: 'sv-nam-bac', name: 'VN Giong Nam - Mien Bac', lang: 'vi-VN', isFallback: true, pitch: 0.6, rateBoost: 0.95 },
      { voiceURI: 'sv-nu-nam',  name: 'VN Giong Nu - Mien Nam',  lang: 'vi-VN', isFallback: true, pitch: 1.2, rateBoost: 1.0  },
      { voiceURI: 'sv-nam-nam', name: 'VN Giong Nam - Mien Nam', lang: 'vi-VN', isFallback: true, pitch: 0.4, rateBoost: 0.95 },
      { voiceURI: 'vi-VN-HoaiMyNeural', name: 'Microsoft Hoài My Online (Natural) - Vietnamese (Vietnam)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 },
      { voiceURI: 'vi-VN-NamMinhNeural', name: 'Microsoft Nam Minh Online (Natural) - Vietnamese (Vietnam)', lang: 'vi-VN', isFallback: true, pitch: 1.0, rateBoost: 1.0 }
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
    const MAX = 3000; 
    const subChunks = paragraphText.length <= MAX
      ? [paragraphText]
      : this.splitParagraphForFallback(paragraphText, MAX);

    const voiceName = this._getSAPIVoiceName();
    
    const fetchPromises = subChunks.map(text => 
      fetch('/offline/synthesize', {
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
        
        const audio = new Audio("data:audio/mp3;base64," + data.audioBase64);
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

  async downloadAudio(text, mode, fileName, onProgress, silenceDuration = 0, exportSrt = false) {
    const chunks = this.chunkText(text);
    if (chunks.length === 0) throw new Error('Khong co noi dung de tai xuong.');

    if (mode === 'offline') {
      return this._downloadOfflineSAPI(chunks, fileName, onProgress, silenceDuration, exportSrt);
    } else {
      return this._downloadOnline(chunks, fileName, onProgress);
    }
  }

  async _downloadOfflineSAPI(chunks, fileName, onProgress, silenceDuration = 0, exportSrt = false) {
    const voiceName = this._getSAPIVoiceName();
    const rate      = this.rate;

    // Use chunks directly to preserve semantic pauses (paragraphs/sentences)
    const batches = [];
    for (const chunk of chunks) {
      const subChunks = this.splitParagraphForFallback(chunk, 3000);
      batches.push(...subChunks);
    }
    const total = batches.length;

    const CONCURRENCY = 1; // Sequential to avoid rate limiting from Microsoft Edge TTS
    const DELAY_BETWEEN_MS = 600; // ms between requests
    console.log(`[EdgeTTS-offline] Tong hop: ${total} batch. Song song: ${CONCURRENCY} luong (sequential). Silence: ${silenceDuration}s. SRT: ${exportSrt}`);

    let completed = 0;
    const results = new Array(total).fill(null);

    const synthesizeMp3 = async (text, idx) => {
      for (let attempt = 0; attempt < 4; attempt++) {
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
          const data = await resp.json();
          if (!data.audioBase64 || data.audioBase64.length < 10) throw new Error('Empty audioBase64');
          
          const binary = atob(data.audioBase64);
          const buf = new Uint8Array(binary.length);
          for(let i=0; i<binary.length; i++) buf[i] = binary.charCodeAt(i);
          
          return { audioBuf: buf, vttText: data.vtt || '', originalText: text };
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

    let queueIdx = 0;
    const workerPipeline = async (workerIdx) => {
      await new Promise(r => setTimeout(r, workerIdx * 200));
      while (queueIdx < total) {
        const i = queueIdx++;
        const res = await synthesizeMp3(batches[i], i);
        results[i] = res;
        if (!res) skippedCount++;
        completed++;
        const pct = Math.round((completed / total) * 93);
        onProgress && onProgress(pct);
        if (queueIdx < total) await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, (_, idx) => workerPipeline(idx)));

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
    // (Vì 1 giây silenceBuf có size cố định, ta có thể tính byte length tỷ lệ thuận)
    const byteRate = oneSecSilence.length; // bytes per second
    const silenceBufLength = Math.floor(byteRate * (pauseMs / 1000));
    const silenceBuf = new Uint8Array(silenceBufLength);
    // Fill with zero to create silent mp3 frame data? No, mp3 is not just zeros.
    // Dùng frame silence lặp lại
    let offsetS = 0;
    while(offsetS < silenceBufLength) {
      const chunk = oneSecSilence.subarray(0, Math.min(oneSecSilence.length, silenceBufLength - offsetS));
      silenceBuf.set(chunk, offsetS);
      offsetS += chunk.length;
    }

    let totalAudioLength = 0;
    for (let i = 0; i < validResults.length; i++) {
      totalAudioLength += validResults[i].audioBuf.length;
      if (i < validResults.length - 1) {
        totalAudioLength += silenceBuf.length;
      }
    }

    const merged = new Uint8Array(totalAudioLength);
    let offset = 0;
    
    let srtContent = "";
    let srtIndex = 1;
    let currentOffsetMs = 0;

    for (let i = 0; i < validResults.length; i++) {
      const res = validResults[i];
      merged.set(res.audioBuf, offset);
      offset += res.audioBuf.length;
      
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
        merged.set(silenceBuf, offset);
        offset += silenceBuf.length;
        currentOffsetMs += pauseMs;
      }
    }

    const blob = new Blob([merged], { type: 'audio/mpeg' });
    const outName = fileName.replace(/\.[^.]+$/, '.mp3');
    this._triggerDownload(blob, outName);
    
    if (exportSrt && srtContent) {
      const srtBlob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
      const srtOutName = fileName.replace(/\.[^.]+$/, '.srt');
      this._triggerDownload(srtBlob, srtOutName);
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
      if (uri === 'vi-VN-HoaiMyNeural') return 'vi-VN-HoaiMyNeural';
      if (uri === 'vi-VN-NamMinhNeural') return 'vi-VN-NamMinhNeural';
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

    let totalLength = 0;
    for (let i = 0; i < mp3Buffers.length; i++) {
      totalLength += mp3Buffers[i].length;
      if (i < mp3Buffers.length - 1) totalLength += silenceBuf.length;
    }
    
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (let i = 0; i < mp3Buffers.length; i++) {
      merged.set(mp3Buffers[i], offset); 
      offset += mp3Buffers[i].length;
      if (i < mp3Buffers.length - 1) {
        merged.set(silenceBuf, offset);
        offset += silenceBuf.length;
      }
    }
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
