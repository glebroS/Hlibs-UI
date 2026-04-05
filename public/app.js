/* ═══════════════════════════════════════════════════════════════════════════
   HLIBS-UI  ·  App Logic
   ═══════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
let currentConvId   = crypto.randomUUID();
let currentMessages = [];
let isStreaming      = false;
let tokenCount       = 0;
let streamStartTime  = 0;

// ── Vitals history (30 data points each) ─────────────────────────────────────
const HISTORY_LEN = 30;
const vitalsHistory = { cpu: [], ram: [], vram: [], temp: [] };

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chatHistory  = document.getElementById('chat-history');
const userInput    = document.getElementById('user-input');
const convTitle    = document.getElementById('conv-title');
const convList     = document.getElementById('conv-list');
const statusDot    = document.getElementById('status-dot');
const sendBtn      = document.getElementById('send-btn');
const statMsgs     = document.getElementById('stat-msgs');
const statCtx      = document.getElementById('stat-ctx');
const statSpeed    = document.getElementById('stat-speed');

// ── Upload state ──────────────────────────────────────────────────────────────
let currentAttachments = [];
const fileUploadInput = document.getElementById('file-upload');
const uploadBtn = document.getElementById('upload-btn');
const attachmentsPreview = document.getElementById('attachments-preview');

// ── Slider sync ───────────────────────────────────────────────────────────────
[['min_p', 2], ['temp', 2], ['rep_pen', 2], ['top_k', 0], ['ctx', 0], ['max_tokens', 0], ['miro_tau', 1]].forEach(([id, dec]) => {
    const el  = document.getElementById(id);
    const disp = document.getElementById(`${id}_val`);
    if (!el || !disp) return;
    const fmt = v => dec === 0 ? parseInt(v).toLocaleString() : parseFloat(v).toFixed(dec);
    el.addEventListener('input', e => { disp.textContent = fmt(e.target.value); });
});

// ── Mirostat segmented control ────────────────────────────────────────────────
let mirostatVal = 0;
document.querySelectorAll('#mirostat-ctrl .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#mirostat-ctrl .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        mirostatVal = parseInt(btn.dataset.val);
        document.getElementById('mirostat_val').textContent = btn.textContent;
        const tauGroup = document.getElementById('miro-tau-group');
        tauGroup.style.opacity = mirostatVal > 0 ? '1' : '0.3';
        tauGroup.style.pointerEvents = mirostatVal > 0 ? 'auto' : 'none';
    });
});

// ── Seed random button ────────────────────────────────────────────────────────
document.getElementById('seed-random-btn').addEventListener('click', () => {
    document.getElementById('seed').value = '';
    document.getElementById('seed_val').textContent = 'Random';
});
document.getElementById('seed').addEventListener('input', e => {
    document.getElementById('seed_val').textContent = e.target.value ? e.target.value : 'Random';
});

// ── Status dot helpers ────────────────────────────────────────────────────────
function setStatus(state) {
    statusDot.className = `status-dot ${state}`;
}

// ── Think-tag renderer ────────────────────────────────────────────────────────
function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMarkdownAndThink(rawText) {
    // Normalise any legacy/alternative tags to the exact model marker
    let text = rawText
        .replace(/<\|channel>thought/gi, '<|think|>')
        .replace(/<channel\|>/gi, '</think>')
        .replace(/<\|?think\|?>/gi, '<|think|>')
        .replace(/<\/\|?think\|?>/gi, '</think>');

    const thinkRe = /<\|think\|>([\s\S]*?)<\/think>/gi;
    let result = '';
    let lastIndex = 0;
    let match;

    while ((match = thinkRe.exec(text)) !== null) {
        const prose = text.slice(lastIndex, match.index);
        if (prose.trim()) result += marked.parse(prose);
        
        const thoughtContent = match[1].trim();
        if (thoughtContent) {
            result += `
<details class="think-block">
  <summary>🧠 Model Logic</summary>
  <div class="think-content">${escapeHtml(thoughtContent)}</div>
</details>`;
        }
        lastIndex = match.index + match[0].length;
    }

    // Unclosed (still streaming)
    const unclosed = text.indexOf('<|think|>', lastIndex);
    if (unclosed !== -1) {
        const before = text.slice(lastIndex, unclosed);
        if (before.trim()) result += marked.parse(before);
        const thinkContent = text.slice(unclosed + 9).trim();
        
        if (thinkContent) {
            result += `
<details class="think-block" open>
  <summary>🧠 Model Logic (streaming…)</summary>
  <div class="think-content">${escapeHtml(thinkContent)}</div>
</details>`;
        }
    } else {
        const remaining = text.slice(lastIndex);
        if (remaining.trim()) result += marked.parse(remaining);
    }

    return result;
}

// ── Incremental streaming DOM ─────────────────────────────────────────────────
// Creates a lightweight DOM tree for word-by-word streaming.
// No marked.parse() is called during streaming — just textContent mutations.
// A single renderMarkdownAndThink() call happens once the stream is fully done.
function createStreamNodes(container) {
    container.innerHTML = '';

    // Cursor blink element
    const cursor = document.createElement('span');
    cursor.className = 'stream-cursor';
    cursor.textContent = '▌';

    // Text before <think> tag
    const preDiv = document.createElement('div');
    preDiv.className = 'markdown-body';
    container.appendChild(preDiv);

    // Think block — hidden until we see <think>
    const thinkDetails = document.createElement('details');
    thinkDetails.className = 'think-block';
    thinkDetails.open = true;
    thinkDetails.style.display = 'none';

    const thinkSummary = document.createElement('summary');
    thinkSummary.textContent = "🧠 Model Logic (streaming…)";
    const thinkContentEl = document.createElement('div');
    thinkContentEl.className = 'think-content';
    thinkContentEl.style.whiteSpace = 'pre-wrap';
    thinkDetails.appendChild(thinkSummary);
    thinkDetails.appendChild(thinkContentEl);
    container.appendChild(thinkDetails);

    // Text after </think>
    const postDiv = document.createElement('div');
    postDiv.className = 'markdown-body';
    container.appendChild(postDiv);

    container.appendChild(cursor);

    return { container, preDiv, thinkDetails, thinkSummary, thinkContentEl, postDiv, cursor };
}

// Called with the FULL accumulated rawText on every token (state machine-free).
// Uses direct .nodeValue / .textContent so the browser never re-parses HTML.
let _rafPending = false;
let _rafNodes   = null;
let _rafText    = '';

function scheduleStreamRender(nodes, rawText) {
    _rafNodes = nodes;
    _rafText  = rawText;
    if (!_rafPending) {
        _rafPending = true;
        requestAnimationFrame(_applyStreamRender);
    }
}

function _applyStreamRender() {
    _rafPending = false;
    if (!_rafNodes) return;
    const { preDiv, thinkDetails, thinkSummary, thinkContentEl, postDiv, cursor } = _rafNodes;

    // Normalise think tag variants aggressively to catch model quirks
    const text = _rafText
        .replace(/<\|channel>thought/gi, '<|think|>')
        .replace(/<channel\|>/gi, '</think>')
        .replace(/<\|?think\|?>/gi, '<|think|>')
        .replace(/<\/\|?think\|?>/gi, '</think>');

    const openIdx  = text.indexOf('<|think|>');
    const closeIdx = text.indexOf('</think>');

    if (openIdx === -1) {
        // No think block yet — all text goes into pre node
        preDiv.innerHTML = marked.parse(text);
        thinkDetails.style.display = 'none';
        return;
    }

    // Before <|think|>
    preDiv.innerHTML = marked.parse(text.slice(0, openIdx));

    if (closeIdx === -1) {
        // Inside think block — still streaming
        const contentInside = text.slice(openIdx + 9);
        if (contentInside.trim() !== '') {
            if (thinkDetails.style.display === 'none') thinkDetails.style.display = '';
            thinkContentEl.textContent = contentInside;
        } else {
            thinkDetails.style.display = 'none';
        }
        postDiv.innerHTML = '';
    } else {
        // Think block complete
        const contentInside = text.slice(openIdx + 9, closeIdx);
        if (contentInside.trim() !== '') {
            if (thinkDetails.style.display === 'none') thinkDetails.style.display = '';
            thinkContentEl.textContent = contentInside;
            thinkSummary.textContent = "🧠 Model Logic";
            if (!thinkDetails.dataset.closedBefore) {
                thinkDetails.dataset.closedBefore = 'true';
                thinkDetails.open = false; // collapse when done only once
            }
        } else {
            thinkDetails.style.display = 'none';
        }
        postDiv.innerHTML = marked.parse(text.slice(closeIdx + 8));
    }
}

// ── Append message bubble ─────────────────────────────────────────────────────
function appendMessage(role, content, images = []) {
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user-msg' : 'assistant-msg'}`;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = role === 'user' ? 'You' : (document.getElementById('model-select').value || 'Assistant');
    div.appendChild(meta);

    const body = document.createElement('div');
    if (role === 'user') {
        body.textContent = content;
        if (images && images.length > 0) {
            const imgContainer = document.createElement('div');
            imgContainer.style.display = 'flex';
            imgContainer.style.gap = '8px';
            imgContainer.style.marginTop = '8px';
            images.forEach(img => {
                const imgEl = document.createElement('img');
                imgEl.src = `data:image/jpeg;base64,${img}`;
                imgEl.style.maxWidth = '150px';
                imgEl.style.maxHeight = '150px';
                imgEl.style.borderRadius = 'var(--radius-sm)';
                imgContainer.appendChild(imgEl);
            });
            body.appendChild(imgContainer);
        }
    } else {
        body.innerHTML = renderMarkdownAndThink(content);
    }
    div.appendChild(body);

    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return { div, body };
}

// ── Render full conversation ──────────────────────────────────────────────────
function renderConversation(messages) {
    chatHistory.innerHTML = '';
    messages.forEach(m => appendMessage(m.role, m.content, m.images));
    updateStats();
}

// ── Stats update ──────────────────────────────────────────────────────────────
function updateStats() {
    const numCtx = parseInt(document.getElementById('ctx').value);
    const estimated = currentMessages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
    statMsgs.textContent = currentMessages.length;
    statCtx.textContent  = `${estimated} / ${numCtx.toLocaleString()} tk`;
    statCtx.style.color  = estimated > numCtx * 0.85 ? 'var(--orange-warn)' : 'var(--purple)';
}

// ── Persist conversation ──────────────────────────────────────────────────────
async function saveConversation() {
    if (currentMessages.length === 0) return;
    const firstUser = currentMessages.find(m => m.role === 'user');
    const title = firstUser
        ? firstUser.content.slice(0, 55) + (firstUser.content.length > 55 ? '…' : '')
        : 'Untitled';

    await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentConvId, title, messages: currentMessages })
    }).catch(() => {});

    convTitle.textContent = title;
    loadConversationList();
}

// ── Load sidebar list ─────────────────────────────────────────────────────────
async function loadConversationList() {
    try {
        const res  = await fetch('/api/conversations');
        const list = await res.json();
        convList.innerHTML = '';

        if (list.length === 0) {
            convList.innerHTML = '<div style="font-size:0.7rem;color:rgba(230,230,250,0.25);padding:4px;">No saved conversations.</div>';
            return;
        }

        list.forEach(conv => {
            const item = document.createElement('div');
            item.className = `conv-item${conv.id === currentConvId ? ' active' : ''}`;
            item.textContent = conv.title || 'Untitled';
            item.title = new Date(conv.updatedAt).toLocaleString();
            item.onclick = () => loadConversation(conv.id);
            convList.appendChild(item);
        });
    } catch { /* server might not be ready */ }
}

// ── Load specific conversation ────────────────────────────────────────────────
async function loadConversation(id) {
    const res  = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    currentConvId   = data.id;
    currentMessages = data.messages;
    convTitle.textContent = data.title || 'Conversation';
    renderConversation(data.messages);
    loadConversationList();
    setStatus('idle');
}

// ── New conversation ──────────────────────────────────────────────────────────
function newConversation() {
    currentConvId   = crypto.randomUUID();
    currentMessages = [];
    chatHistory.innerHTML = `
        <div class="message assistant-msg welcome-msg">
            <div class="msg-meta">SYSTEM</div>
            New conversation started. Ready for input.
        </div>`;
    convTitle.textContent = 'New Conversation';
    tokenCount = 0;
    updateStats();
    loadConversationList();
    setStatus('idle');
}

// ── Get current settings ──────────────────────────────────────────────────────
function getSettings() {
    const seedEl  = document.getElementById('seed');
    const seedVal = seedEl.value ? parseInt(seedEl.value) : undefined;
    return {
        model:    document.getElementById('model-select').value,
        options: {
            min_p:          parseFloat(document.getElementById('min_p').value),
            temperature:    parseFloat(document.getElementById('temp').value),
            repeat_penalty: parseFloat(document.getElementById('rep_pen').value),
            top_k:          parseInt(document.getElementById('top_k').value),
            num_ctx:        parseInt(document.getElementById('ctx').value),
            num_predict:    parseInt(document.getElementById('max_tokens').value),
            mirostat:       mirostatVal,
            mirostat_tau:   mirostatVal > 0 ? parseFloat(document.getElementById('miro_tau').value) : undefined,
            seed:           seedVal
        }
    };
}

// ── Build system prompt ───────────────────────────────────────────────────────
function getSystemPrompt() {
    const custom = document.getElementById('system-prompt').value.trim();
    const forceThink = document.getElementById('force_think').checked;

    let prompt = custom || '';
    if (forceThink) {
        prompt = '<|think|>\n' + prompt;
    }
    return prompt.trim() || undefined;
}

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage() {
    const text = userInput.value.trim();
    if ((!text && currentAttachments.length === 0) || isStreaming) return;

    isStreaming = true;
    sendBtn.disabled = true;
    setStatus('thinking');

    if (currentMessages.length === 0) chatHistory.innerHTML = '';

    userInput.value = '';
    userInput.style.height = 'auto';

    const imagesToPass = [...currentAttachments];
    currentMessages.push({ role: 'user', content: text, images: imagesToPass });
    appendMessage('user', text, imagesToPass);

    // Clear attachments
    currentAttachments = [];
    renderAttachments();

    // Typing indicator placeholder
    const placeholderDiv = document.createElement('div');
    placeholderDiv.className = 'message assistant-msg';
    placeholderDiv.innerHTML = `
        <div class="msg-meta">${document.getElementById('model-select').value}</div>
        <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>`;
    chatHistory.appendChild(placeholderDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    const { model, options } = getSettings();
    const systemPrompt = getSystemPrompt();

    // Build messages array for /api/chat — no manual concatenation needed
    const ollamaMessages = [];
    if (systemPrompt) ollamaMessages.push({ role: 'system', content: systemPrompt });
    ollamaMessages.push(...currentMessages); // all roles: user / assistant

    let currentResponse = '';
    let chunkCount = 0;
    let isReasoningApi = false;
    streamStartTime = Date.now();

    try {
        // Call Ollama /api/chat directly — no server proxy, no context-string overhead
        const res = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: ollamaMessages,
                stream: true,
                options: {
                    min_p:          options.min_p,
                    temperature:    options.temperature,
                    repeat_penalty: options.repeat_penalty,
                    top_k:          options.top_k,
                    num_ctx:        options.num_ctx,
                    num_predict:    options.num_predict,
                    mirostat:       options.mirostat,
                    ...(options.mirostat_tau != null && { mirostat_tau: options.mirostat_tau }),
                    ...(options.seed        != null && { seed: options.seed })
                }
            })
        });

        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: Is Ollama running?`);

        const reader  = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        // Swap placeholder → live streaming nodes (no marked.parse overhead)
        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        meta.textContent = model;
        const body = document.createElement('div');
        placeholderDiv.innerHTML = '';
        placeholderDiv.appendChild(meta);
        placeholderDiv.appendChild(body);

        // Create the incremental streaming DOM structure
        const streamNodes = createStreamNodes(body);
        let rafScrollPending = false;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    
                    const reasoning = parsed.message?.reasoning_content || parsed.message?.thinking;
                    if (reasoning) {
                        isReasoningApi = true;
                        if (!currentResponse.includes('<|think|>')) {
                            currentResponse += '<|think|>\n';
                        }
                        currentResponse += reasoning;
                        chunkCount++;
                        if (chunkCount % 4 === 0) scheduleStreamRender(streamNodes, currentResponse);
                    }

                    const token = parsed.message?.content;
                    if (token) {
                        if (isReasoningApi && currentResponse.includes('<|think|>') && !currentResponse.includes('</think>')) {
                            currentResponse += '\n</think>\n';
                            isReasoningApi = false;
                        }
                        currentResponse += token;
                        chunkCount++;
                        if (chunkCount % 4 === 0) scheduleStreamRender(streamNodes, currentResponse);
                    }

                    // Scroll throttled to rAF as well
                    if (!rafScrollPending) {
                        rafScrollPending = true;
                        const isNearBottom = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight < 120;
                        requestAnimationFrame(() => {
                            if (isNearBottom) chatHistory.scrollTop = chatHistory.scrollHeight;
                            rafScrollPending = false;
                        });
                    }

                    // Speed stat every 15 chunks
                    if (chunkCount % 15 === 0) {
                        const elapsed = (Date.now() - streamStartTime) / 1000;
                        const tokens  = Math.ceil(currentResponse.length / 4);
                        statSpeed.textContent = `${(tokens / elapsed).toFixed(1)} tk/s`;
                    }
                } catch { /* skip malformed chunk */ }
            }
        }

        // ── Stream done: remove cursor, do one final markdown render ──────────
        _rafNodes = null; // cancel any pending rAF
        body.innerHTML = renderMarkdownAndThink(currentResponse);
        
        const isNearBottomFinal = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight < 300;
        if (isNearBottomFinal) chatHistory.scrollTop = chatHistory.scrollHeight;

        currentMessages.push({ role: 'assistant', content: currentResponse });
        await saveConversation();
        updateStats();

        const elapsed = (Date.now() - streamStartTime) / 1000;
        const tokens  = Math.ceil(currentResponse.length / 4);
        statSpeed.textContent = `${(tokens / elapsed).toFixed(1)} tk/s`;
        setStatus('idle');

    } catch (err) {
        placeholderDiv.innerHTML = `
            <div class="msg-meta">ERROR</div>
            <span style="color:var(--red-warn)">⚠ ${err.message}. Is Ollama running on port 11434?</span>`;
        setStatus('error');
    }

    isStreaming   = false;
    sendBtn.disabled = false;
}

// ── Export .md ────────────────────────────────────────────────────────────────
document.getElementById('save-chat-btn').addEventListener('click', async () => {
    if (currentMessages.length === 0) { alert('Nothing to export yet.'); return; }
    const title = convTitle.textContent;
    const lines = [`# ${title}\n\n*Exported from Hlibs-UI · ${new Date().toLocaleString()}*\n`];
    currentMessages.forEach(m => {
        lines.push(`## ${m.role === 'user' ? '👤 User' : '🤖 Assistant'}\n\n${m.content}\n`);
    });
    const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: lines.join('\n---\n\n') })
    });
    const data = await res.json();
    if (data.success) alert(`✅ Exported: saved_outputs/${data.file}`);
});

// ── New conversation button ───────────────────────────────────────────────────
document.getElementById('new-chat-btn').addEventListener('click', newConversation);

// ── Clear all conversations ───────────────────────────────────────────────────
document.getElementById('clear-all-btn').addEventListener('click', async () => {
    if (!confirm('Delete ALL saved conversations? This cannot be undone.')) return;
    const res  = await fetch('/api/conversations');
    const list = await res.json();
    await Promise.all(list.map(c => fetch(`/api/conversations/${c.id}`, { method: 'DELETE' })));
    newConversation();
});

// ── Auto-resize textarea ──────────────────────────────────────────────────────
userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
});

// ── File upload handling ──────────────────────────────────────────────────────
function renderAttachments() {
    attachmentsPreview.innerHTML = '';
    currentAttachments.forEach((b64, idx) => {
        const item = document.createElement('div');
        item.className = 'attachment-item';
        
        const img = document.createElement('img');
        img.src = `data:image/jpeg;base64,${b64}`;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'attachment-remove';
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => {
            currentAttachments.splice(idx, 1);
            renderAttachments();
        };
        
        item.appendChild(img);
        item.appendChild(removeBtn);
        attachmentsPreview.appendChild(item);
    });
}

function handleUpload(file) {
    if (!file) return;
    uploadBtn.style.opacity = '0.5';
    const formData = new FormData();
    formData.append('file', file);
    
    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(r => r.json())
    .then(data => {
        if (data.success && data.base64) {
            currentAttachments.push(data.base64);
            renderAttachments();
        }
    })
    .catch(console.error)
    .finally(() => {
        uploadBtn.style.opacity = '1';
        fileUploadInput.value = '';
    });
}

uploadBtn.addEventListener('click', () => fileUploadInput.click());
fileUploadInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleUpload(e.target.files[0]);
});

// Drag and drop
document.querySelector('.input-area').addEventListener('dragover', e => {
    e.preventDefault();
    e.currentTarget.style.borderColor = 'var(--purple)';
});
document.querySelector('.input-area').addEventListener('dragleave', e => {
    e.preventDefault();
    e.currentTarget.style.borderColor = 'transparent';
});
document.querySelector('.input-area').addEventListener('drop', e => {
    e.preventDefault();
    e.currentTarget.style.borderColor = 'transparent';
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files[0]);
});

// ── Context slider updates stat display ───────────────────────────────────────
document.getElementById('ctx').addEventListener('input', updateStats);

// ═══ VITALS SPARKLINES ════════════════════════════════════════════════════════

function pushHistory(key, value) {
    vitalsHistory[key].push(value);
    if (vitalsHistory[key].length > HISTORY_LEN) vitalsHistory[key].shift();
}

// Render SVG polyline sparkline
function renderSparkline(svgId, history, color, warnThresh, dangerThresh) {
    const svg = document.getElementById(svgId);
    if (!svg || history.length < 2) return;

    const W = 120, H = 36, PAD = 2;

    // gradient fill area
    const min  = 0;
    const max  = 100;
    const xStep = (W - PAD * 2) / (HISTORY_LEN - 1);

    const pts = history.map((v, i) => {
        const x = PAD + i * xStep;
        const y = H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    // Build area polygon
    const firstX = PAD;
    const lastX  = PAD + (history.length - 1) * xStep;
    const areaPoints = [`${firstX.toFixed(1)},${H}`, ...pts, `${lastX.toFixed(1)},${H}`].join(' ');

    // Determine color based on latest value
    const latest = history[history.length - 1];
    const lineColor = latest >= dangerThresh ? 'var(--red-warn)' : latest >= warnThresh ? 'var(--orange-warn)' : color;

    svg.innerHTML = `
        <defs>
            <linearGradient id="g-${svgId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="${lineColor}" stop-opacity="0.02"/>
            </linearGradient>
        </defs>
        <polygon points="${areaPoints}" fill="url(#g-${svgId})" />
        <polyline points="${pts.join(' ')}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${lastX.toFixed(1)}" cy="${pts[pts.length-1].split(',')[1]}" r="2.5" fill="${lineColor}" style="filter:drop-shadow(0 0 3px ${lineColor})"/>
    `;
}

function updateVitals() {
    const cpu  = Math.round(18 + Math.random() * 60);
    const ram  = Math.round(38 + Math.random() * 24);
    const vram = Math.round(60 + Math.random() * 35);
    const temp = Math.round(36 + Math.random() * 28);

    pushHistory('cpu',  cpu);
    pushHistory('ram',  ram);
    pushHistory('vram', vram);
    pushHistory('temp', temp);

    // Update display values + css color
    const setVal = (id, val, warn, danger, suffix = '%') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = val + suffix;
        el.className = 'vital-value' + (id === 'temp-val' ? ' temp-val' : '');
        if (val >= danger) el.classList.add('danger');
        else if (val >= warn) el.classList.add('warn');
    };

    setVal('cpu-val',  cpu,  70, 90);
    setVal('ram-val',  ram,  75, 90);
    setVal('vram-val', vram, 80, 95);
    setVal('temp-val', temp, 75, 88, '°C');

    renderSparkline('cpu-spark',  vitalsHistory.cpu,  'var(--purple)', 70, 90);
    renderSparkline('ram-spark',  vitalsHistory.ram,  'var(--purple)', 75, 90);
    renderSparkline('vram-spark', vitalsHistory.vram, 'var(--accent)', 80, 95);
    renderSparkline('temp-spark', vitalsHistory.temp, 'var(--teal)',   75, 88);
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
    // Pre-fill history for immediate sparklines
    for (let i = 0; i < HISTORY_LEN; i++) {
        pushHistory('cpu',  25 + Math.random() * 30);
        pushHistory('ram',  40 + Math.random() * 15);
        pushHistory('vram', 65 + Math.random() * 20);
        pushHistory('temp', 40 + Math.random() * 15);
    }
    updateVitals();
    setInterval(updateVitals, 2000);

    setStatus('idle');
    await loadConversationList();
})();
