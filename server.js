const express = require('express');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// PPE Warrior IVR Configuration
const CONFIG = {
  cellNumber: process.env.CELL_NUMBER || '4149284663',
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb'
};

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'PPE Warrior AI-IVR Online',
    number: '414-928-4773',
    time: new Date().toISOString()
  });
});

// Phone.com webhook - receives inbound calls
app.post('/inbound', (req, res) => {
  const caller = req.body.caller_id_number || 'unknown';
  const called = req.body.destination_number || 'unknown';
  const callId = req.body.call_uuid || crypto.randomUUID();

  console.log(`[${new Date().toISOString()}] CALL ${callId} | From: ${caller} | To: ${called}`);

  // Play IVR greeting, then ring cell with MOH
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>https://phone-ivr-bri.s3.amazonaws.com/warrior-ivr.mp3</Play>
  <Dial timeout="30" record="true" recordingStatusCallback="/recording/${callId}" recordingFormat="mp3" beep="true">
    <Number>${CONFIG.cellNumber}</Number>
  </Dial>
</Response>`;

  res.type('text/xml').send(twiml);
});

// Phone.com call status webhook
app.post('/status/:callId?', (req, res) => {
  const status = req.body.status || 'unknown';
  const duration = req.body.duration || 0;
  const callId = req.params.callId || 'unknown';
  console.log(`[STATUS] ${callId} -> ${status} (${duration}s)`);
  res.sendStatus(200);
});

// Call recording webhook
app.post('/recording/:callId', (req, res) => {
  const recordingUrl = req.body.recording_url || '';
  const callId = req.params.callId || 'unknown';
  console.log(`[RECORDING] ${callId} -> ${recordingUrl}`);
  // Forward recording URL to Telegram (via log — Render log streaming captures this)
  console.log(`[ALERT] New voicemail from ${req.body.caller_id_number || 'unknown'}: ${recordingUrl}`);
  res.sendStatus(200);
});

// ElevenLabs dynamic voice generation
app.post('/generate-voice', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const postData = JSON.stringify({
    text,
    model_id: 'eleven_flash_v2_5',
    voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
  });

  const options = {
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${CONFIG.elevenlabsVoiceId}`,
    method: 'POST',
    headers: {
      'xi-api-key': CONFIG.elevenlabsApiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    }
  };

  const chunks = [];
  const proxyReq = https.request(options, (proxyRes) => {
    proxyRes.on('data', c => chunks.push(c));
    proxyRes.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length < 1000) res.status(500).json({ error: buf.toString() });
      else res.type('audio/mpeg').send(buf);
    });
  });
  proxyReq.on('error', e => res.status(500).json({ error: e.message }));
  proxyReq.write(postData);
  proxyReq.end();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PPE Warrior AI-IVR running on port ${PORT}`);
});
