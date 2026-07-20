import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Play, Pause, SkipBack, SkipForward, FileText, Headphones, FileDown, Download, Wifi, WifiOff, Folder, File, StopCircle, CheckCircle, XCircle, Clock, Loader } from 'lucide-react';
import { parseFile } from './services/fileParser';
import ttsService from './services/ttsService';

// File extensions supported
const SUPPORTED_EXTS = ['.txt', '.pdf', '.epub'];
const isSupportedFile = (name) => SUPPORTED_EXTS.some(ext => name.toLowerCase().endsWith(ext));

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
  const folderInputRef = useRef(null);

  // ─── Upload file name state ────────────────────────────────────────────────
  const [uploadedFileName, setUploadedFileName] = useState('');

  // ─── Download state (single file) ─────────────────────────────────────────
  const [downloadMode, setDownloadMode] = useState('offline');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState(null);
  const [downloadDone, setDownloadDone] = useState(false);

  // ─── Batch (folder) state ──────────────────────────────────────────────────
  const [folderMode, setFolderMode] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [batchFiles, setBatchFiles] = useState([]); // File[]
  const [batchStatus, setBatchStatus] = useState([]); // [{name, status, progress, error}]
  const [batchIndex, setBatchIndex] = useState(-1);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const batchCancelledRef = useRef(false);

  useEffect(() => {
    ttsService.getVoices().then(availableVoices => {
      const sortedVoices = [...availableVoices].sort((a, b) => {
        const aLang = a.lang || '';
        const bLang = b.lang || '';
        if (aLang.startsWith('vi') && !bLang.startsWith('vi')) return -1;
        if (!aLang.startsWith('vi') && bLang.startsWith('vi')) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      setVoices(sortedVoices);
      const defaultVoice = sortedVoices.find(v => (v.lang || '').startsWith('vi')) || sortedVoices.find(v => v.isFallback) || sortedVoices[0];
      if (defaultVoice) setSelectedVoice(defaultVoice.voiceURI);
    }).catch(err => console.error('Error loading voices:', err));

    ttsService.onStateChange = (playing) => setIsPlaying(playing);
    ttsService.onProgress = (current, total) => {
      setProgress({ current, total });
      if (total > 0 && current < total) setCurrentText(ttsService.chunks[current]);
      else setCurrentText('');
    };
    return () => ttsService.stop();
  }, []);

  useEffect(() => {
    ttsService.setSettings(selectedVoice, rate, pitch);
  }, [selectedVoice, rate, pitch]);

  // ─── Single file handler ───────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setFolderMode(false);
    setIsParsing(true);
    setError(null);
    setDownloadDone(false);
    setDownloadProgress(0);
    ttsService.stop();
    setUploadedFileName(file.name || 'audio');
    try {
      const text = await parseFile(file);
      ttsService.loadText(text);
    } catch (err) {
      setError('Không thể đọc file: ' + err.message);
    } finally {
      setIsParsing(false);
    }
  };

  // ─── Folder handler ────────────────────────────────────────────────────────
  const handleFolder = (files) => {
    // files: FileList từ input[webkitdirectory] hoặc DataTransfer
    const validFiles = Array.from(files)
      .filter(f => isSupportedFile(f.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (validFiles.length === 0) {
      setError('Không tìm thấy file .txt/.pdf/.epub nào trong thư mục đã chọn.');
      return;
    }

    // Lấy tên thư mục từ webkitRelativePath
    const folderPath = validFiles[0].webkitRelativePath || '';
    const folderNamePart = folderPath.split('/')[0] || 'Thư mục';

    setFolderMode(true);
    setFolderName(folderNamePart);
    setBatchFiles(validFiles);
    setBatchStatus(validFiles.map(f => ({ name: f.name, status: 'pending', progress: 0, error: null })));
    setBatchIndex(-1);
    setIsBatchRunning(false);
    setDownloadDone(false);
    setDownloadError(null);
    setError(null);
    ttsService.stop();
    setUploadedFileName('');
    setProgress({ current: 0, total: 0 });
  };

  // ─── Drag & Drop ───────────────────────────────────────────────────────────
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

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entry = items[0].webkitGetAsEntry?.();
      if (entry && entry.isDirectory) {
        // Đọc nội dung thư mục
        const dirReader = entry.createReader();
        const allFiles = [];
        const readEntries = () => {
          dirReader.readEntries((entries) => {
            if (entries.length === 0) {
              // Chuyển FileSystemEntry -> File
              const filePromises = allFiles.map(e => new Promise(res => e.file(res)));
              Promise.all(filePromises).then(files => handleFolder(files));
            } else {
              allFiles.push(...entries.filter(en => en.isFile));
              readEntries();
            }
          });
        };
        readEntries();
        return;
      }
    }

    // Fallback: single file
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  // ─── Playback ──────────────────────────────────────────────────────────────
  const togglePlay = () => {
    if (isPlaying) ttsService.pause();
    else ttsService.resume();
  };

  const handleProgressClick = (e) => {
    if (progress.total === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    ttsService.seek(Math.floor(ratio * progress.total));
  };

  // ─── Single file download ──────────────────────────────────────────────────
  const handleDownload = async () => {
    if (progress.total === 0) {
      setDownloadError('Vui lòng tải lên một file sách trước.');
      return;
    }
    setIsDownloading(true);
    setDownloadError(null);
    setDownloadDone(false);
    setDownloadProgress(0);

    const baseName = uploadedFileName ? uploadedFileName.replace(/\.[^.]+$/, '') : 'audio';
    const outFileName = baseName + '.mp3';

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

  // ─── Batch download ────────────────────────────────────────────────────────
  const handleBatchDownload = async () => {
    if (batchFiles.length === 0) return;
    batchCancelledRef.current = false;
    setIsBatchRunning(true);
    setDownloadDone(false);
    setDownloadError(null);

    // Reset status
    setBatchStatus(batchFiles.map(f => ({ name: f.name, status: 'pending', progress: 0, error: null })));

    for (let i = 0; i < batchFiles.length; i++) {
      if (batchCancelledRef.current) break;

      const file = batchFiles[i];
      setBatchIndex(i);

      // Mark as processing
      setBatchStatus(prev => {
        const next = [...prev];
        next[i] = { ...next[i], status: 'processing', progress: 0 };
        return next;
      });

      try {
        // Parse file
        const text = await parseFile(file);
        ttsService.loadText(text);

        if (batchCancelledRef.current) break;

        const baseName = file.name.replace(/\.[^.]+$/, '');
        await ttsService.downloadAudio(
          ttsService.chunks.join('\n\n'),
          downloadMode,
          baseName + '.mp3',
          (pct) => {
            setBatchStatus(prev => {
              const next = [...prev];
              next[i] = { ...next[i], progress: Math.round(pct) };
              return next;
            });
          }
        );

        setBatchStatus(prev => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'done', progress: 100 };
          return next;
        });
      } catch (err) {
        setBatchStatus(prev => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'error', error: err.message };
          return next;
        });
      }
    }

    setIsBatchRunning(false);
    setBatchIndex(-1);
    if (!batchCancelledRef.current) setDownloadDone(true);
  };

  const handleBatchCancel = () => {
    batchCancelledRef.current = true;
    setIsBatchRunning(false);
    setBatchIndex(-1);
  };

  // Counts
  const batchDoneCount = batchStatus.filter(s => s.status === 'done').length;
  const batchTotalProgress = batchFiles.length > 0
    ? Math.round((batchDoneCount / batchFiles.length) * 100)
    : 0;

  const outputFormat = 'MP3';

  // ─── Status icon component ─────────────────────────────────────────────────
  const StatusIcon = ({ status }) => {
    if (status === 'done')       return <CheckCircle size={16} color="#4ade80" />;
    if (status === 'error')      return <XCircle size={16} color="#f87171" />;
    if (status === 'processing') return <Loader size={16} color="#a78bfa" style={{ animation: 'spin 1s linear infinite' }} />;
    return <Clock size={16} color="#9ca3af" />;
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>AI Audiobook</h1>
        <p>Đọc sách định dạng TXT, PDF, EPUB với giọng nói tự nhiên hoàn toàn miễn phí</p>
      </header>

      <main>
        {/* ─── Upload Area ─────────────────────────────────────────────────── */}
        <div className="glass-panel" style={{ marginBottom: '2rem' }}>
          <div
            className={`file-drop-area ${isDragging ? 'drag-over' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".txt,.pdf,.epub"
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <input
              type="file"
              ref={folderInputRef}
              style={{ display: 'none' }}
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => handleFolder(e.target.files)}
            />

            <Upload size={48} color="var(--accent-primary)" style={{ opacity: 0.8 }} />
            <h3>Kéo thả file hoặc thư mục vào đây</h3>
            <p>Hỗ trợ PDF, EPUB, TXT – chọn 1 file hoặc cả 1 thư mục</p>

            {/* Buttons row */}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={() => fileInputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.4rem', fontSize: '0.9rem' }}
              >
                <File size={18} /> Chọn file
              </button>
              <button
                className="btn"
                onClick={() => folderInputRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.6rem 1.4rem', fontSize: '0.9rem',
                  background: 'rgba(167,139,250,0.2)', borderColor: 'rgba(167,139,250,0.5)'
                }}
              >
                <Folder size={18} /> Chọn thư mục
              </button>
            </div>

            {/* Single file name */}
            {uploadedFileName && !isParsing && !folderMode && (
              <p style={{ color: 'var(--accent-primary)', marginTop: '0.75rem', fontWeight: 600 }}>
                📄 {uploadedFileName}
              </p>
            )}

            {/* Folder summary */}
            {folderMode && batchFiles.length > 0 && (
              <p style={{ color: '#a78bfa', marginTop: '0.75rem', fontWeight: 600 }}>
                📂 {folderName} – {batchFiles.length} file ({SUPPORTED_EXTS.join(', ')})
              </p>
            )}

            {isParsing && <p style={{ color: 'var(--accent-hover)', marginTop: '1rem' }}>Đang phân tích sách... Xin chờ</p>}
            {error && <p style={{ color: '#ef4444', marginTop: '1rem' }}>{error}</p>}
          </div>
        </div>

        {/* ─── Controls Row ─────────────────────────────────────────────────── */}
        <div className="controls-row">
          <div className="glass-panel" style={{ flex: 1 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <Headphones size={24} /> Cài đặt giọng đọc
            </h3>

            <div className="settings-group">
              <label>Giọng nói</label>
              <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}>
                {voices.filter(v => (v.lang || '').startsWith('vi') && !v.isFallback).length > 0 && (
                  <optgroup label="🖥️ Giọng hệ thống (Tiếng Việt)">
                    {voices.filter(v => (v.lang || '').startsWith('vi') && !v.isFallback).map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                    ))}
                  </optgroup>
                )}
                {voices.filter(v => v.isFallback && (v.lang || '').startsWith('vi')).length > 0 && (
                  <optgroup label="🎤 Giọng mô phỏng (Tiếng Việt)">
                    {voices.filter(v => v.isFallback && (v.lang || '').startsWith('vi')).map(v => {
                      const labelMap = {
                        'sv-nu-bac':  '🇻🇳 Microsoft Hoài My (Nữ)',
                        'sv-nam-bac': '🇻🇳 Microsoft Nam Minh (Nam)',
                        'sv-nu-nam':  '🇻🇳 Giọng Nữ (Dự phòng)',
                        'sv-nam-nam': '🇻🇳 Giọng Nam (Dự phòng)',
                      };
                      return (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {labelMap[v.voiceURI] || v.name}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                {voices.filter(v => !(v.lang || '').startsWith('vi') && !v.isFallback).length > 0 && (
                  <optgroup label="🌐 Ngôn ngữ khác">
                    {voices.filter(v => !(v.lang || '').startsWith('vi') && !v.isFallback).map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                    ))}
                  </optgroup>
                )}
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
              <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} />
            </div>

            <div className="settings-group">
              <label>Cao độ: {pitch.toFixed(1)}</label>
              <input type="range" min="0" max="2" step="0.1" value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} />
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
              />
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

        {/* ─── Download Section ──────────────────────────────────────────────── */}
        <div className="glass-panel" style={{ marginTop: '2rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <Download size={24} /> Tải xuống audio
          </h3>

          {/* Mode selector */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
              padding: '0.75rem 1.25rem', borderRadius: '0.75rem',
              border: `2px solid ${downloadMode === 'offline' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.15)'}`,
              background: downloadMode === 'offline' ? 'rgba(99,102,241,0.15)' : 'transparent',
              transition: 'all 0.2s', flex: 1, minWidth: '180px',
            }}>
              <input type="radio" name="downloadMode" value="offline" checked={downloadMode === 'offline'} onChange={() => setDownloadMode('offline')} style={{ accentColor: 'var(--accent-primary)', width: '18px', height: '18px' }} />
              <WifiOff size={20} style={{ color: 'var(--accent-primary)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Offline – SAPI (Im lặng)</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Xuất MP3 qua Windows SAPI – không phát qua loa, dùng toàn bộ CPU</div>
              </div>
            </label>

            <label style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
              padding: '0.75rem 1.25rem', borderRadius: '0.75rem',
              border: `2px solid ${downloadMode === 'online' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.15)'}`,
              background: downloadMode === 'online' ? 'rgba(99,102,241,0.15)' : 'transparent',
              transition: 'all 0.2s', flex: 1, minWidth: '180px',
            }}>
              <input type="radio" name="downloadMode" value="online" checked={downloadMode === 'online'} onChange={() => setDownloadMode('online')} style={{ accentColor: 'var(--accent-primary)', width: '18px', height: '18px' }} />
              <Wifi size={20} style={{ color: 'var(--accent-primary)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Online (Google TTS)</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Tải từ Google – xuất MP3, cần internet</div>
              </div>
            </label>
          </div>

          {/* ── SINGLE FILE mode UI ── */}
          {!folderMode && (
            <>
              {uploadedFileName && (
                <div style={{ marginBottom: '1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                  📁 File tải về: <strong style={{ color: 'var(--accent-primary)' }}>
                    {uploadedFileName.replace(/\.[^.]+$/, '.mp3')}
                  </strong>
                </div>
              )}

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
                  <div style={{ width: '100%', height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${downloadProgress}%`, background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-hover))', borderRadius: '999px', transition: 'width 0.3s ease' }} />
                  </div>
                </div>
              )}

              {downloadDone && !isDownloading && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '0.75rem', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80', fontSize: '0.9rem' }}>
                  ✅ Tải xuống hoàn tất! File <strong>{uploadedFileName.replace(/\.[^.]+$/, '.mp3')}</strong> đã được lưu.
                </div>
              )}

              {downloadError && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '0.75rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', fontSize: '0.9rem' }}>
                  ❌ {downloadError}
                </div>
              )}

              <button
                id="btn-download-audio"
                className="btn"
                onClick={handleDownload}
                disabled={isDownloading || progress.total === 0}
                style={{ width: '100%', padding: '0.9rem', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', opacity: (isDownloading || progress.total === 0) ? 0.5 : 1, cursor: (isDownloading || progress.total === 0) ? 'not-allowed' : 'pointer' }}
              >
                {isDownloading ? (
                  <>
                    <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                    {downloadMode === 'offline'
                      ? (downloadProgress < 82 ? `Đang tổng hợp (${downloadProgress}%)...` : `Đang mã hoá MP3 (${downloadProgress}%)...`)
                      : `Đang tải... ${downloadProgress}%`}
                  </>
                ) : (
                  <><Download size={20} /> Tải xuống audio ({outputFormat})</>
                )}
              </button>
            </>
          )}

          {/* ── FOLDER / BATCH mode UI ── */}
          {folderMode && batchFiles.length > 0 && (
            <>
              {/* Overall progress */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-muted)' }}>
                    📂 {folderName}
                    {isBatchRunning && batchIndex >= 0 && (
                      <span style={{ marginLeft: '0.5rem', color: '#a78bfa' }}>
                        – File {batchIndex + 1}/{batchFiles.length}
                      </span>
                    )}
                  </span>
                  <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{batchTotalProgress}%</span>
                </div>
                <div style={{ width: '100%', height: '10px', borderRadius: '999px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${batchTotalProgress}%`, background: 'linear-gradient(90deg, #6366f1, #a78bfa)', borderRadius: '999px', transition: 'width 0.4s ease' }} />
                </div>
              </div>

              {/* File list table */}
              <div style={{ marginBottom: '1.25rem', maxHeight: '320px', overflowY: 'auto', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.08)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, width: '40%' }}>Tên file</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, width: '20%' }}>Trạng thái</th>
                      <th style={{ padding: '0.6rem 0.8rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, width: '40%' }}>Tiến độ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchStatus.map((item, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          background: idx === batchIndex ? 'rgba(99,102,241,0.08)' : 'transparent',
                          transition: 'background 0.2s',
                        }}
                      >
                        <td style={{ padding: '0.55rem 0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                          <span style={{ color: item.status === 'done' ? '#4ade80' : item.status === 'error' ? '#f87171' : item.status === 'processing' ? '#a78bfa' : 'var(--text-muted)' }}>
                            {item.name}
                          </span>
                        </td>
                        <td style={{ padding: '0.55rem 0.8rem', textAlign: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                            <StatusIcon status={item.status} />
                            {item.status === 'done' && <span style={{ color: '#4ade80' }}>Xong</span>}
                            {item.status === 'error' && <span style={{ color: '#f87171' }}>Lỗi</span>}
                            {item.status === 'processing' && <span style={{ color: '#a78bfa' }}>Đang xử lý</span>}
                            {item.status === 'pending' && <span style={{ color: '#9ca3af' }}>Chờ</span>}
                          </span>
                        </td>
                        <td style={{ padding: '0.55rem 0.8rem' }}>
                          {item.status === 'processing' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                              <div style={{ flex: 1, height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden', maxWidth: '80px' }}>
                                <div style={{ height: '100%', width: `${item.progress}%`, background: 'linear-gradient(90deg, #6366f1, #a78bfa)', borderRadius: '999px', transition: 'width 0.3s ease' }} />
                              </div>
                              <span style={{ color: '#a78bfa', minWidth: '32px', textAlign: 'right' }}>{item.progress}%</span>
                            </div>
                          ) : item.status === 'done' ? (
                            <span style={{ color: '#4ade80', textAlign: 'right', display: 'block' }}>100%</span>
                          ) : item.status === 'error' ? (
                            <span style={{ color: '#f87171', fontSize: '0.75rem', textAlign: 'right', display: 'block' }} title={item.error}>Thất bại</span>
                          ) : (
                            <span style={{ color: '#9ca3af', textAlign: 'right', display: 'block' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Done message */}
              {downloadDone && !isBatchRunning && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '0.75rem', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80', fontSize: '0.9rem' }}>
                  ✅ Đã hoàn thành {batchDoneCount}/{batchFiles.length} file. Các MP3 đã được lưu tự động.
                </div>
              )}

              {downloadError && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '0.75rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', fontSize: '0.9rem' }}>
                  ❌ {downloadError}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  className="btn"
                  onClick={handleBatchDownload}
                  disabled={isBatchRunning}
                  style={{ flex: 1, padding: '0.9rem', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', opacity: isBatchRunning ? 0.5 : 1, cursor: isBatchRunning ? 'not-allowed' : 'pointer' }}
                >
                  {isBatchRunning ? (
                    <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span> Đang xử lý hàng loạt...</>
                  ) : (
                    <><Download size={20} /> Xuất tất cả thành MP3</>
                  )}
                </button>

                {isBatchRunning && (
                  <button
                    className="btn"
                    onClick={handleBatchCancel}
                    style={{ padding: '0.9rem 1.25rem', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.5)', color: '#f87171' }}
                  >
                    <StopCircle size={20} /> Dừng
                  </button>
                )}
              </div>
            </>
          )}

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
