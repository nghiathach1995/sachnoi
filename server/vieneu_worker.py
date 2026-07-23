import sys
import json
import base64
import io
import soundfile as sf
import os
import traceback

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
sys.stdin.reconfigure(encoding='utf-8')

def main():
    print("LOADING", flush=True)
    try:
        from vieneu import Vieneu
        v = Vieneu(backend="onnx")
        print("READY", flush=True)
    except Exception as e:
        print(f"ERROR: Failed to load Vieneu: {e}", flush=True)
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = req.get("text", "")
            voice = req.get("voice", "Phạm Tuyên")
            
            audio = v.infer(text, voice=voice)
            
            # Save to WAV in memory
            buffer = io.BytesIO()
            sf.write(buffer, audio, 48000, format='WAV', subtype='PCM_16')
            wav_bytes = buffer.getvalue()
            
            b64 = base64.b64encode(wav_bytes).decode('utf-8')
            
            out = {"id": req_id, "audioBase64": b64}
            print(json.dumps(out), flush=True)
        except Exception as e:
            err = {"id": req.get("id", "unknown"), "error": str(e), "traceback": traceback.format_exc()}
            print(json.dumps(err), flush=True)

if __name__ == "__main__":
    main()
