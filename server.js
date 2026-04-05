const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const multer  = require('multer');

const app  = express();
const PORT = 3000;
const CONVERSATIONS_DIR = path.join(__dirname, 'conversations');
const SAVED_OUTPUTS_DIR = path.join(__dirname, 'saved_outputs');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

[CONVERSATIONS_DIR, SAVED_OUTPUTS_DIR, UPLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});
const upload = multer({ storage: storage });

// ── Conversation persistence ───────────────────────────────────────────────────

app.get('/api/conversations', (req, res) => {
    try {
        const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
        const list  = files.map(f => {
            const d = JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, f), 'utf8'));
            return { id: d.id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt, messageCount: d.messages.length };
        }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        res.json(list);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/conversations/:id', (req, res) => {
    try {
        const fp = path.join(CONVERSATIONS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
        res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/conversations', (req, res) => {
    try {
        const { id, title, messages } = req.body;
        const convId = id || uuidv4();
        const fp     = path.join(CONVERSATIONS_DIR, `${convId}.json`);
        const existing = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : {};
        const data = {
            id:        convId,
            title:     title || existing.title || 'New Conversation',
            createdAt: existing.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages:  messages || existing.messages || []
        };
        fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
        res.json({ success: true, id: convId, title: data.title });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/conversations/:id', (req, res) => {
    try {
        const fp = path.join(CONVERSATIONS_DIR, `${req.params.id}.json`);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── File Uploads ───────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
        // For passing straightforwardly to Ollama via client, send back base64 string
        const buffer = fs.readFileSync(req.file.path);
        const base64 = buffer.toString('base64');
        res.json({
            success: true,
            filename: req.file.filename,
            url: `/uploads/${req.file.filename}`,
            base64: base64
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Export as .md ──────────────────────────────────────────────────────────────
app.post('/api/save', (req, res) => {
    try {
        const { title, content } = req.body;
        if (!content) return res.status(400).json({ error: 'Content required.' });
        const safe      = (title || 'log').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename  = `${safe}_${timestamp}.md`;
        fs.writeFileSync(path.join(SAVED_OUTPUTS_DIR, filename), content, 'utf8');
        res.json({ success: true, file: filename });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Hlibs-UI → http://localhost:${PORT}`));
