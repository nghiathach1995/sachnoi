/**
 * ttsMiddleware.cjs
 * Vite dev-server middleware: silent offline TTS via Microsoft Edge TTS (edge-tts Python package)
 * Supports true Vietnamese Neural voices: vi-VN-HoaiMyNeural, vi-VN-NamMinhNeural
 *
 * Endpoints:
 *   GET  /offline/voices      -> JSON array of voice objects
 *   POST /offline/synthesize  -> MP3 audio buffer (body: {text, voiceName, rate, pitch})
 */

'use strict';
const { execFile, spawn } = require('child_process');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
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

// Map of friendly display names to edge-tts voice IDs
const VOICE_MAP = {
  // Exact names from Web Speech API (Chrome/Edge on Windows)
  'Microsoft Hoai My Online (Natural) - Vietnamese (Vietnam)':   'vi-VN-HoaiMyNeural',
  'Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)':    'vi-VN-HoaiMyNeural',
  'Microsoft Hoài My Online (Natural) - Vietnamese (Vietnam)':   'vi-VN-HoaiMyNeural',
  'Microsoft Hoài My Online (Natural) – Vietnamese (Vietnam)':   'vi-VN-HoaiMyNeural',
  'Microsoft Nam Minh Online (Natural) - Vietnamese (Vietnam)':  'vi-VN-NamMinhNeural',
  'Microsoft NamMinh Online (Natural) - Vietnamese (Vietnam)':   'vi-VN-NamMinhNeural',
  'Microsoft Nam Minh Online (Natural) – Vietnamese (Vietnam)':  'vi-VN-NamMinhNeural',
  // Edge-tts IDs passed directly
  'vi-VN-HoaiMyNeural':  'vi-VN-HoaiMyNeural',
  'vi-VN-NamMinhNeural': 'vi-VN-NamMinhNeural',
  // Fallback names from ttsService
  'Microsoft Hoai My Online (Natural) - Vietnamese (Vietnam)':   'vi-VN-HoaiMyNeural',
};

const VOICE_LIST = [
  { name: 'Microsoft Hoai My Online (Natural) - Vietnamese (Vietnam)',  edgeId: 'vi-VN-HoaiMyNeural',  gender: 'Female' },
  { name: 'Microsoft Nam Minh Online (Natural) - Vietnamese (Vietnam)', edgeId: 'vi-VN-NamMinhNeural', gender: 'Male'   },
];

/** Resolve a voiceName string to an edge-tts voice ID.
 * Client now sends exact IDs like "vi-VN-HoaiMyNeural" directly.
 * This function is kept as a safety fallback only.
 */
function resolveVoice(voiceName) {
  if (!voiceName) return 'vi-VN-HoaiMyNeural';

  // If it's already a valid edge-tts voice ID, use it directly
  const known = ['vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural'];
  if (known.includes(voiceName)) return voiceName;

  // Safety fallback: check for known keywords
  const lower = voiceName.toLowerCase();

  // Must check 'hoai' first before any 'nam' check
  if (lower.includes('hoai')) return 'vi-VN-HoaiMyNeural';

  // 'nam minh' or 'namminh' specifically — NOT just 'nam' (which matches "Vietnam")
  if (lower.includes('namminh') || lower.includes('nam minh') || lower.includes('minh')) {
    return 'vi-VN-NamMinhNeural';
  }

  // Default
  console.warn('[TTS-offline] Unknown voice "' + voiceName + '", defaulting to HoaiMyNeural');
  return 'vi-VN-HoaiMyNeural';
}

// ── /offline/voices ────────────────────────────────────────────────────────────

function getVoices() {
  return Promise.resolve(VOICE_LIST.map(v => v.name));
}

// ── /offline/synthesize ────────────────────────────────────────────────────────

/**
 * Synthesize text to MP3 using edge-tts (Microsoft Edge Neural TTS).
 * edge-tts supports true Vietnamese Neural voices via the internet-facing Microsoft API.
 * However it uses the same backend as Edge browser's read-aloud, which is fast.
 *
 * @param {string} text       - Text to speak
 * @param {string} voiceName  - Display name or edge-tts voice ID
 * @param {number} webRate    - Web Speech rate (0.5–2, default 1)
 * @returns {Buffer} MP3 audio buffer
 */
async function synthesizeMp3(text, voiceName, webRate = 1) {
  const edgeVoiceId = resolveVoice(voiceName);

  // Log voice resolution to help debug
  console.log(`[TTS-offline] Voice: "${voiceName}" -> "${edgeVoiceId}"`);

  // Convert Web Speech rate (0.5–2) -> edge-tts rate string (+XX% or -XX%)
  const ratePct = Math.round((webRate - 1) * 100);
  const rateStr = (ratePct >= 0 ? '+' : '') + ratePct + '%';

  // Sanitize text: remove control chars, trim
  const cleanText = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim();
  if (!cleanText) throw new Error('Text rong sau khi xu ly');

  const id      = crypto.randomBytes(8).toString('hex');
  const tmpDir  = os.tmpdir();
  const txtFile = path.join(tmpDir, `tts_in_${id}.txt`);
  const mp3File = path.join(tmpDir, `tts_out_${id}.mp3`);

  fs.writeFileSync(txtFile, cleanText, 'utf8');

  // Build Python script for edge-tts
  const escapedTxt = txtFile.replace(/\\/g, '\\\\');
  const escapedMp3 = mp3File.replace(/\\/g, '\\\\');

  const pyScript = `
import asyncio, edge_tts, sys

async def main():
    with open(r'${escapedTxt}', 'r', encoding='utf-8') as f:
        text = f.read().strip()
    if not text:
        print('SKIP_EMPTY')
        return
    communicate = edge_tts.Communicate(text, '${edgeVoiceId}', rate='${rateStr}')
    await communicate.save(r'${escapedMp3}')
    print('OK')

asyncio.run(main())
`.trim();

  const pyFile = path.join(tmpDir, `tts_py_${id}.py`);
  fs.writeFileSync(pyFile, pyScript, 'utf8');

  try {
    await new Promise((resolve, reject) => {
      execFile('python', [pyFile], { timeout: 90000, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      });
    });

    if (!fs.existsSync(mp3File)) {
      throw new Error('MP3 file was not created by edge-tts.');
    }
    const mp3 = fs.readFileSync(mp3File);
    return mp3;
  } finally {
    for (const f of [txtFile, pyFile, mp3File]) {
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
          return Promise.resolve(null);
        }
        return synthesizeMp3(text, voiceName || '', rate || 1);
      })
      .then(mp3Buf => {
        if (!mp3Buf) return;
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', mp3Buf.length);
        res.end(mp3Buf);
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
