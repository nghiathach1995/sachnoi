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
const readline = require('readline');

// ── Vieneu Worker Manager ──────────────────────────────────────────────────────
let vieneuProcess = null;
let vieneuRl = null;
let vieneuPending = new Map();

function getVieneuWorker() {
  if (vieneuProcess && !vieneuProcess.killed) return vieneuProcess;

  vieneuProcess = spawn('python', [path.join(__dirname, 'vieneu_worker.py')]);
  
  vieneuRl = readline.createInterface({
    input: vieneuProcess.stdout,
    terminal: false
  });

  vieneuRl.on('line', (line) => {
    if (line === 'LOADING' || line === 'READY' || line.startsWith('ERROR:')) {
      console.log(`[VieNeu Worker] ${line}`);
      return;
    }
    try {
      const data = JSON.parse(line);
      const reqId = data.id;
      if (reqId && vieneuPending.has(reqId)) {
        const { resolve, reject } = vieneuPending.get(reqId);
        vieneuPending.delete(reqId);
        if (data.error) reject(new Error(data.error + '\n' + data.traceback));
        else resolve(data);
      }
    } catch (e) {
      console.log(`[VieNeu Worker stdout]: ${line}`);
    }
  });

  vieneuProcess.stderr.on('data', data => {
    console.error(`[VieNeu Worker stderr]: ${data.toString().trim()}`);
  });

  vieneuProcess.on('close', code => {
    console.log(`[VieNeu Worker] Closed with code ${code}`);
    for (const { reject } of vieneuPending.values()) {
      reject(new Error('Vieneu worker process closed unexpectedly'));
    }
    vieneuPending.clear();
    vieneuProcess = null;
  });

  return vieneuProcess;
}

function synthesizeVieneu(text, voice) {
  return new Promise((resolve, reject) => {
    const worker = getVieneuWorker();
    const id = crypto.randomUUID();
    vieneuPending.set(id, { resolve, reject });
    
    const req = JSON.stringify({ id, text, voice });
    worker.stdin.write(req + '\n');
  });
}

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
  { name: 'VieNeu Phạm Tuyên (Local AI - Nam)', edgeId: 'Phạm Tuyên', gender: 'Male' },
  { name: 'VieNeu Minh Đức (Local AI - Nam)', edgeId: 'Minh Đức', gender: 'Male' },
  { name: 'VieNeu Minh Hoàng (Local AI - Nam)', edgeId: 'Minh Hoàng', gender: 'Male' },
  { name: 'VieNeu Ngọc Trân (Local AI - Nữ)', edgeId: 'Ngọc Trân', gender: 'Female' },
  { name: 'VieNeu Mai Phương (Local AI - Nữ)', edgeId: 'Mai Phương', gender: 'Female' },
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
  let cleanText = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim();
  if (!cleanText) throw new Error('Text rong sau khi xu ly');

  // Regex for valid Vietnamese syllable
  const vnSyllableRegex = /^(b|c|ch|d|đ|g|gh|gi|h|k|kh|l|m|n|ng|ngh|nh|p|ph|q|qu|r|s|t|th|tr|v|x)?([aáàảãạăắằẳẵặâấầẩẫậeéèẻẽẹêếềểễệiíìỉĩịoóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữựyýỳỷỹỵ]+)(c|ch|m|n|ng|nh|p|t)?$/i;

  function escapeXML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  let resultSSML = '';
  // Split text into words and non-words
  const tokens = cleanText.split(/([a-zA-ZÀ-ỹĐđ]+)/);
  for (let token of tokens) {
    if (!token) continue;
    if (/[a-zA-ZÀ-ỹĐđ]+/.test(token)) {
      if (vnSyllableRegex.test(token)) {
        resultSSML += escapeXML(token); // Vietnamese word
      } else {
        resultSSML += `<lang xml:lang="en-US">${escapeXML(token)}</lang>`; // Foreign word
      }
    } else {
      resultSSML += escapeXML(token); // Punctuation, spaces, numbers, etc
    }
  }

  // Construct full SSML
  const ssmlContent = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'><voice name='${edgeVoiceId}'><prosody rate='${rateStr}'>${resultSSML}</prosody></voice></speak>`;

  const id      = crypto.randomBytes(8).toString('hex');
  const tmpDir  = os.tmpdir();
  const txtFile = path.join(tmpDir, `tts_in_${id}.txt`);
  const mp3File = path.join(tmpDir, `tts_out_${id}.mp3`);

  fs.writeFileSync(txtFile, ssmlContent, 'utf8');

  // Build Python script for edge-tts
  const escapedTxt = txtFile.replace(/\\/g, '\\\\');
  const escapedMp3 = mp3File.replace(/\\/g, '\\\\');

  const pyScript = `
import asyncio, edge_tts, sys, base64, json, os
from edge_tts.submaker import SubMaker

async def main():
    with open(r'${escapedTxt}', 'r', encoding='utf-8') as f:
        ssml = f.read().strip()
    if not ssml:
        print('SKIP_EMPTY')
        return
        
    class SSMLCommunicate(edge_tts.Communicate):
        def __init__(self, ssml_str, **kwargs):
            super().__init__("", **kwargs)
            self.ssml = ssml_str
        def mkssml(self) -> str:
            return self.ssml

    last_error = None
    for attempt in range(4):
        try:
            communicate = SSMLCommunicate(ssml, voice='${edgeVoiceId}')
            submaker = SubMaker()
            audio_bytes = bytearray()
            
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_bytes.extend(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    submaker.feed(chunk)
            
            if len(audio_bytes) < 100:
                raise Exception(f"Audio too short: {len(audio_bytes)} bytes")
            
            with open(r'${escapedMp3}', "wb") as f:
                f.write(audio_bytes)
            
            audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
            vtt_text = submaker.get_srt()
            
            out_dict = {"audioBase64": audio_b64, "vtt": vtt_text}
            print(json.dumps(out_dict))
            return
        except Exception as e:
            last_error = str(e)
            wait_time = (attempt + 1) * 1.5
            sys.stderr.write(f"Attempt {attempt+1} failed: {e}, retrying in {wait_time}s\\n")
            await asyncio.sleep(wait_time)
    
    sys.stderr.write(f"All attempts failed: {last_error}\\n")
    sys.exit(1)

asyncio.run(main())
`.trim();

  const pyFile = path.join(tmpDir, `tts_py_${id}.py`);
  fs.writeFileSync(pyFile, pyScript, 'utf8');

  try {
    const result = await new Promise((resolve, reject) => {
      execFile('python', [pyFile], { timeout: 120000, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const errMsg = stderr ? stderr.trim() : err.message;
          console.error('[TTS-offline] Python error:', errMsg.substring(0, 300));
          reject(new Error(errMsg));
        } else {
          resolve(stdout.trim());
        }
      });
    });

    if (result === 'SKIP_EMPTY') {
      return { audioBase64: '', vtt: '' };
    }
    
    if (!result) {
      throw new Error('Python script produced no output');
    }

    try {
      const parsed = JSON.parse(result);
      if (!parsed.audioBase64 || parsed.audioBase64.length < 10) {
        throw new Error('Empty audioBase64 in response');
      }
      return parsed;
    } catch (e) {
      throw new Error('Invalid output from python: ' + result.substring(0, 200));
    }
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
      .then(result => {
        if (!result) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      })
      .catch(err => {
        console.error('[TTS-offline] synthesize error:', err.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // POST /offline/vieneu
  if (req.method === 'POST' && url === '/offline/vieneu') {
    readBody(req)
      .then(({ text, voiceName }) => {
        if (!text || text.trim().length === 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Empty text' }));
          return Promise.resolve(null);
        }
        return synthesizeVieneu(text, voiceName || 'Phạm Tuyên');
      })
      .then(result => {
        if (!result) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      })
      .catch(err => {
        console.error('[TTS-offline] vieneu synthesize error:', err.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  next();
};
