import sys, json
from faster_whisper import WhisperModel
model = WhisperModel(sys.argv[2], device='cpu', compute_type='int8', cpu_threads=4)
segments, info = model.transcribe(sys.argv[1], beam_size=3, vad_filter=True)
print(json.dumps({'text': ' '.join(s.text.strip() for s in segments), 'language': info.language}, ensure_ascii=True))
