/**
 * ttsMiddleware.cjs
 * Vite dev-server middleware: silent offline TTS via Windows SAPI (PowerShell)
 * Endpoints:
 *   GET  /offline/voices      -> JSON array of installed SAPI voice names
 *   POST /offline/synthesize  -> WAV audio buffer (body: {text, voiceName, rate})
 */

'use strict';
const { execFile } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');

// ── helpers ────────────────────────────────────────────────────────────────────

/** Read full JSON body from an IncomingMessage */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/** Run a PowerShell script file silently, return stdout */
function runPowerShell(psFile, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
      { timeout: timeoutMs, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      }
    );
  });
}

// ── /offline/voices ────────────────────────────────────────────────────────────

async function getVoices() {
  const id     = crypto.randomBytes(6).toString('hex');
  const psFile = path.join(os.tmpdir(), `tts_voices_${id}.ps1`);

  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$synth  = New-Object System.Speech.Synthesis.SpeechSynthesizer
$names  = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
$synth.Dispose()
$names -join "|"
`.trim();

  fs.writeFileSync(psFile, script, 'utf8');
  try {
    const out = await runPowerShell(psFile, 15000);
    return out ? out.split('|').map(n => n.trim()).filter(Boolean) : [];
  } finally {
    try { fs.unlinkSync(psFile); } catch {}
  }
}

// ── /offline/synthesize ────────────────────────────────────────────────────────

/**
 * Synthesize `text` silently to WAV using Windows SAPI.
 * @param {string} text        - Text to speak
 * @param {string} voiceName   - SAPI voice name (e.g. "Microsoft Hoai My")
 * @param {number} webRate     - Web Speech rate (0.5–2, default 1)
 * @returns {Buffer} WAV audio buffer
 */
async function synthesizeWav(text, voiceName, webRate = 1) {
  // Convert Web Speech rate (0.5–2) → SAPI rate (-10…+10)
  const sapiRate = Math.max(-10, Math.min(10, Math.round((webRate - 1) * 10)));

  const id      = crypto.randomBytes(8).toString('hex');
  const tmpDir  = os.tmpdir();
  const txtFile = path.join(tmpDir, `tts_in_${id}.txt`);
  const wavFile = path.join(tmpDir, `tts_out_${id}.wav`);
  const psFile  = path.join(tmpDir, `tts_ps_${id}.ps1`);

  // Write text as UTF-8 to a temp file (avoids PowerShell escaping issues)
  fs.writeFileSync(txtFile, text, 'utf8');

  // Build PowerShell script
  const escapedWav = wavFile.replace(/\\/g, '\\\\');
  const escapedTxt = txtFile.replace(/\\/g, '\\\\');

  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Set output format: 22050 Hz, 16-bit, mono for best lamejs compatibility
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    22050,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
)
$synth.SetOutputToWaveFile('${escapedWav}', $fmt)

# Set rate
$synth.Rate = ${sapiRate}

# Select voice (try exact match first, then partial)
$installed = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
$target = '${voiceName.replace(/'/g, "''")}'
$matched = $installed | Where-Object { $_ -like "*$target*" } | Select-Object -First 1
if (-not $matched) {
    # Fallback: pick first Vietnamese voice
    $matched = $installed | Where-Object { $_ -like "*Hoai*" -or $_ -like "*An*" -or $_ -like "*Vietnamese*" -or $_ -like "*Viet*" } | Select-Object -First 1
}
if ($matched) { $synth.SelectVoice($matched) }

# Read text from file and speak
$text = [System.IO.File]::ReadAllText('${escapedTxt}', [System.Text.Encoding]::UTF8)
$synth.Speak($text)
$synth.Dispose()
Write-Output "OK"
`.trim();

  fs.writeFileSync(psFile, script, 'utf8');

  try {
    await runPowerShell(psFile, 60000);

    if (!fs.existsSync(wavFile)) {
      throw new Error('WAV file was not created by SAPI.');
    }
    const wav = fs.readFileSync(wavFile);
    return wav;
  } finally {
    // Always clean up temp files
    for (const f of [txtFile, psFile, wavFile]) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}

// ── Middleware export ──────────────────────────────────────────────────────────

module.exports = function ttsMiddleware(req, res, next) {
  const url = req.url.split('?')[0];

  // GET /offline/voices
  if (req.method === 'GET' && url === '/offline/voices') {
    getVoices()
      .then(voices => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(voices));
      })
      .catch(err => {
        console.error('[TTS-offline] voices error:', err.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // POST /offline/synthesize
  if (req.method === 'POST' && url === '/offline/synthesize') {
    readBody(req)
      .then(({ text, voiceName, rate }) => {
        if (!text || text.trim().length === 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Empty text' }));
          return;
        }
        return synthesizeWav(text, voiceName || '', rate || 1);
      })
      .then(wavBuf => {
        if (!wavBuf) return; // already responded with error
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', wavBuf.length);
        res.end(wavBuf);
      })
      .catch(err => {
        console.error('[TTS-offline] synthesize error:', err.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  next();
};
