require('dotenv').config();
const express = require('express');
const multer = require('multer');
const Groq = require('groq-sdk');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
let _groq = null;
function groq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.post('/respond', upload.single('audio'), async (req, res) => {
  const tmpFile = path.join(os.tmpdir(), `buddy-${Date.now()}.wav`);
  try {
    const history = JSON.parse(req.body.history || '[]');

    fs.writeFileSync(tmpFile, req.file.buffer);

    const transcription = await groq().audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: 'whisper-large-v3-turbo',
    });

    const userText = transcription.text.trim();
    if (!userText) return res.json({ transcript: '', response: '' });

    const messages = [
      {
        role: 'system',
        content: `You are Buddy, a genuine close friend having a voice conversation. Rules:
- Always reply in the SAME language the user speaks — Chinese if they speak Chinese, English if English
- Respond in 1-3 SHORT sentences only — this is voice, not text
- Sound like a real person: be casual, natural, use the kind of tone a close friend would use
- Actually engage with what was said — ask a follow-up, share a reaction, be present
- Have opinions and personality, don't be wishy-washy
- If something's funny, be funny. If something's heavy, be real.
- NEVER use lists, bullet points, markdown, or any formatting`,
      },
      ...history.slice(-20),
      { role: 'user', content: userText },
    ];

    const completion = await groq().chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages,
      max_tokens: 150,
      temperature: 0.85,
    });

    const response = completion.choices[0].message.content.trim();
    res.json({ transcript: userText, response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Buddy running on port ${PORT}`));
