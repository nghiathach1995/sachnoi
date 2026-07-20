import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Play, Pause, SkipBack, SkipForward, FileText, Headphones, FileDown, Download, Wifi, WifiOff } from 'lucide-react';
import { parseFile } from './services/fileParser';
import ttsService from './services/ttsService';

function App() {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [currentText, setCurrentText] = useState('');
  
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // ─── Upload file name state ────────────────────────────────────────────────
  const [uploadedFileName, setUploadedFileName] = useState('');

  // ─── Download state ────────────────────────────────────────────────────────
  const [downloadMode, setDownloadMode] = useState('offline'); // 'offline' | 'online'
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState(null);
  const [downloadDone, setDownloadDone] = useState(false);

  useEffect(() => {
    // Load voices
    ttsService.getVoices().then(availableVoices => {
      // Prioritize Vietnamese voices safely
      const sortedVoices = [...availableVoices].sort((a, b) => {
        const aLang = a.lang || '';
        const bLang = b.lang || '';
        if (aLang.startsWith('vi') && !bLang.startsWith('vi')) return -1;
        if (!aLang.startsWith('vi') && bLang.startsWith('vi')) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      
      setVoices(sortedVoices);
      console.log('Available voices:', sortedVoices.map(v => ({name: v.name, lang: v.lang, uri: v.voiceURI, fallback: v.isFallback})));
      
      // Auto-select Vietnamese voice if available
      const defaultVoice = sortedVoices.find(v => (v.lang || '').startsWith('vi')) || sortedVoices.find(v => v.isFallback) || sortedVoices[0];
      if (defaultVoice) {
        setSelectedVoice(defaultVoice.voiceURI);
      }
    }).catch(err => {
      console.error("Error loading voices:", err);
    });

    ttsService.onStateChange = (playing) => {
      setIsPlaying(playing);
    };

    ttsService.onProgress = (current, total) => {
      setProgress({ current, total });
      if (total > 0 && current < total) {
        setCurrentText(ttsService.chunks[current]);
      } else {
        setCurrentText('');
      }
    };

    return () => {
      ttsService.stop();
    };
  }, []);

  useEffect(() => {
    ttsService.setSettings(selectedVoice, rate, pitch);
  }, [selectedVoice, rate, pitch]);

  const handleFile = async (file) => {
    if (!file) return;
    setIsParsing(true);
    setError(null);
    setDownloadDone(false);
    setDownloadProgress(0);
    ttsService.stop();
    
    // Store file name (strip directory path just in case)
    setUploadedFileName(file.name || 'audio');
    
    try {
      const text = await parseFile(file);
      ttsService.loadText(text);
    } catch (err) {
      setError("Không thể đọc file: " + err.message);
    } finally {
      setIsParsing(false);
    }
  };

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const togglePlay = () => {
    if (isPlaying) {
      ttsService.pause();
    } else {
      ttsService.resume();
    }
  };

  const handleProgressClick = (e) => {
    if (progress.total === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const newIndex = Math.floor(ratio * progress.total);
    ttsService.seek(newIndex);
  };

  // ─── Download handler ──────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (progress.total === 0) {
      setDownloadError('Vui lòng tải lên một file sách trước.');
      return;
    }
    setIsDownloading(true);
    setDownloadError(null);
    setDownloadDone(false);
    setDownloadProgress(0);

    // Build output filename from uploaded file name
    const baseName = uploadedFileName
      ? uploadedFileName.replace(/\.[^.]+$/, '')
      : 'audio';
    const outFileName = baseName + '.mp3'; // Ca offline (SAPI) lan online deu xuat .mp3

    try {
      await ttsService.downloadAudio(
        ttsService.chunks.join('\n\n'),
        downloadMode,
        outFileName,
        (pct) => setDownloadProgress(Math.round(pct))
      );
      setDownloadDone(true);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setIsDownloading(false);
    }
  };

  // Friendly output format label
  const outputFormat = 'MP3';

  return (
    <div className="app-container">
      <header className="header">
        <h1>AI Audiobook</h1>
        <p>Đọc sách định dạng TXT, PDF, EPUB với giọng nói tự nhiên hoàn toàn miễn phí</p>
      </header>

      <main>
        <div className="glass-panel" style={{ marginBottom: '2rem' }}>
          <div 
            className={`file-drop-area ${isDragging ? 'drag-over' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              accept=".txt,.pdf,.epub"
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <Upload size={48} color="var(--accent-primary)" style={{ opacity: 0.8 }} />
            <h3>Tải sách của bạn lên</h3>
            <p>Kéo thả hoặc nhấn để chọn file (Hỗ trợ PDF, EPUB, TXT, không giới hạn số trang)</p>
            {uploadedFileName && !isParsing && (
              <p style={{ color: 'var(--accent-primary)', marginTop: '0.5rem', fontWeight: 600 }}>
                📄 {uploadedFileName}
              </p>
            )}
            {isParsing && <p style={{ color: 'var(--accent-hover)', marginTop: '1rem' }}>Đang phân tích sách... Xin chờ</p>}
            {error && <p style={{ color: '#ef4444', marginTop: '1rem' }}>{error}</p>}
          </div>
        </div>

        <div className="controls-row">
          <div className="glass-panel" style={{ flex: 1 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <Headphones size={24} /> Cài đặt giọng đọc
            </h3>
            
            <div className="settings-group">
              <label>Giọng nói</label>
              <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}>
                {/* System Vietnamese voices (native OS) */}
                {voices.filter(v => (v.lang || '').startsWith('vi') && !v.isFallback).length > 0 && (
                  <optgroup label="🖥️ Giọng hệ thống (Tiếng Việt)">
                    {voices.filter(v => (v.lang || '').startsWith('vi') && !v.isFallback).map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                    ))}
                  </optgroup>
                )}
                {/* System Vietnamese fallback voices (gender & region) */}
                {voices.filter(v => v.isFallback && (v.lang || '').startsWith('vi')).length > 0 && (
                  <optgroup label="🎤 Giọng mô phỏng (Tiếng Việt)">
                    {voices.filter(v => v.isFallback && (v.lang || '').startsWith('vi')).map(v => {
                      const labelMap = {
                        'sv-nu-bac':  '🇻🇳 Giọng Nữ – Miền Bắc',
                        'sv-nam-bac': '🇻🇳 Giọng Nam – Miền Bắc',
                        'sv-nu-nam':  '🇻🇳 Giọng Nữ – Miền Nam',
                        'sv-nam-nam': '🇻🇳 Giọng Nam – Miền Nam',
                      };
                      return (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {labelMap[v.voiceURI] || v.name}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                {/* Other languages */}
                {voices.filter(v => !(v.lang || '').startsWith('vi') && !v.isFallback).length > 0 && (
                  <optgroup label="🌐 Ngôn ngữ khác">
                    {voices.filter(v => !(v.lang || '').startsWith('vi') && !v.isFallback).map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                    ))}
                  </optgroup>
                )}
                {/* Dự phòng (any remaining fallback) */}
                {voices.filter(v => v.isFallback && !(v.lang || '').startsWith('vi')).length > 0 && (
                  <optgroup label="⚙️ Dự phòng">
                    {voices.filter(v => v.isFallback && !(v.lang || '').startsWith('vi')).map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            
            <div className="settings-group">
              <label>Tốc độ: {rate.toFixed(1)}x</label>
              <input 
                type="range" 
                min="0.5" max="2" step="0.1" 
                value={rate} 
                onChange={(e) => setRate(parseFloat(e.target.value))} 
              />
            </div>
            
            <div className="settings-group">
              <label>Cao độ: {pitch.toFixed(1)}</label>
              <input 
                type="range" 
                min="0" max="2" step="0.1" 
                value={pitch} 
                onChange={(e) => setPitch(parseFloat(e.target.value))} 
              />
            </div>
          </div>

          <div className="glass-panel" style={{ flex: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', justifyContent: 'center' }}>
              Trình phát <FileText size={20} />
            </h3>
            
            <div className="playback-controls">
              <button className="btn-icon" onClick={() => ttsService.prev()} disabled={progress.total === 0}>
                <SkipBack size={24} />
              </button>
              <button className="btn" onClick={togglePlay} disabled={progress.total === 0} style={{ padding: '1rem', borderRadius: '50%' }}>
                {isPlaying ? <Pause size={32} /> : <Play size={32} style={{ marginLeft: '4px' }} />}
              </button>
              <button className="btn-icon" onClick={() => ttsService.next()} disabled={progress.total === 0}>
                <SkipForward size={24} />
              </button>
            </div>

            <div className="progress-container" onClick={handleProgressClick}>
              <div 
                className="progress-bar" 
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              ></div>
            </div>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {progress.total > 0 ? `${progress.current + 1} / ${progress.total}` : 'Chưa có file nào'}
            </div>
          </div>
        </div>

        {currentText && (
          <div className="glass-panel text-display">
            <h4 style={{ color: 'var(--accent-hover)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileDown size={20} /> Đang đọc
            </h4>
            <p className="highlight">{currentText}</p>
          </div>
        )}

        {/* ─── Download Section ─────────────────────────────────────────────── */}
        <div className="glass-panel" style={{ marginTop: '2rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <Download size={24} /> Tải xuống audio
          </h3>

          {/* Mode selector */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                cursor: 'pointer',
                padding: '0.75rem 1.25rem',
                borderRadius: '0.75rem',
                border: `2px solid ${downloadMode === 'offline' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.15)'}`,
                background: downloadMode === 'offline' ? 'rgba(99,102,241,0.15)' : 'transparent',
                transition: 'all 0.2s',
                flex: 1,
                minWidth: '180px',
              }}
            >
              <input
                type="radio"
                name="downloadMode"
                value="offline"
                checked={downloadMode === 'offline'}
                onChange={() => setDownloadMode('offline')}
                style={{ accentColor: 'var(--accent-primary)', width: '18px', height: '18px' }}
              />
              <WifiOff size={20} style={{ color: 'var(--accent-primary)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Offline – SAPI (Im lặng)</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Xuất MP3 qua Windows SAPI – không phát qua loa, dùng toàn bộ CPU</div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                cursor: 'pointer',
                padding: '0.75rem 1.25rem',
                borderRadius: '0.75rem',
                border: `2px solid ${downloadMode === 'online' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.15)'}`,
                background: downloadMode === 'online' ? 'rgba(99,102,241,0.15)' : 'transparent',
                transition: 'all 0.2s',
                flex: 1,
                minWidth: '180px',
              }}
            >
              <input
                type="radio"
                name="downloadMode"
                value="online"
                checked={downloadMode === 'online'}
                onChange={() => setDownloadMode('online')}
                style={{ accentColor: 'var(--accent-primary)', width: '18px', height: '18px' }}
              />
              <Wifi size={20} style={{ color: 'var(--accent-primary)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Online (Google TTS)</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Tải từ Google – xuất MP3, cần internet</div>
              </div>
            </label>
          </div>

          {/* Output file name preview */}
          {uploadedFileName && (
            <div style={{ marginBottom: '1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              📁 File tải về: <strong style={{ color: 'var(--accent-primary)' }}>
                {uploadedFileName.replace(/\.[^.]+$/, '.mp3')}
              </strong>
            </div>
          )}

          {/* Progress bar */}
          {isDownloading && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                <span>
                  {downloadMode === 'offline'
                    ? (downloadProgress < 82 ? `🔇 Đang tổng hợp giọng nói im lặng (${downloadProgress}%)...` : `🎵 Đang mã hoá MP3...`)
                    : '⬇️ Đang tải audio...'}
                </span>
                <span>{downloadProgress}%</span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.1)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${downloadProgress}%`,
                  background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-hover))',
                  borderRadius: '999px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )}

          {/* Success message */}
          {downloadDone && !isDownloading && (
            <div style={{
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              background: 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(34,197,94,0.4)',
              color: '#4ade80',
              fontSize: '0.9rem',
            }}>
              ✅ Tải xuống hoàn tất! File <strong>{uploadedFileName.replace(/\.[^.]+$/, '.mp3')}</strong> đã được lưu.
            </div>
          )}

          {/* Error message */}
          {downloadError && (
            <div style={{
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.4)',
              color: '#f87171',
              fontSize: '0.9rem',
            }}>
              ❌ {downloadError}
            </div>
          )}

          {/* Download button */}
          <button
            id="btn-download-audio"
            className="btn"
            onClick={handleDownload}
            disabled={isDownloading || progress.total === 0}
            style={{
              width: '100%',
              padding: '0.9rem',
              fontSize: '1rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.6rem',
              opacity: (isDownloading || progress.total === 0) ? 0.5 : 1,
              cursor: (isDownloading || progress.total === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {isDownloading ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                {downloadMode === 'offline'
                  ? (downloadProgress < 82 ? `Đang tổng hợp (${downloadProgress}%)...` : `Đang mã hoá MP3 (${downloadProgress}%)...`)
                  : `Đang tải... ${downloadProgress}%`}
              </>
            ) : (
              <>
                <Download size={20} />
                Tải xuống audio ({outputFormat})
              </>
            )}
          </button>

          <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            {downloadMode === 'offline'
              ? '💡 Offline SAPI: Tổng hợp im lặng qua Windows SAPI (PowerShell), dùng song song toàn bộ CPU. Không phát qua loa. Xuất MP3.'
              : '💡 Online Google TTS: Tải audio tiếng Việt từ Google. Cần internet. Xuất MP3.'}
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
