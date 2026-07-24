import json
with open('C:/Users/Admin/AppData/Local/Programs/Python/Python314/Lib/site-packages/vieneu/assets/voices_v3_turbo.json', encoding='utf-8') as f:
    data = json.load(f)
with open('voices_out.txt', 'w', encoding='utf-8') as f2:
    for k, v in data['presets'].items():
        f2.write(f"{k}: {v.get('description', '')}\n")
