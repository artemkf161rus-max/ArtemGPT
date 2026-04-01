const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// OpenRouter API
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL_NAME = 'nvidia/nemotron-3-super-120b-a12b-20230311:free';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Хранилище диалогов
let sessions = [];
let currentSessionId = null;

function loadSessions() {
    try {
        const filePath = path.join(__dirname, 'sessions.json');
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            sessions = data.sessions || [];
            console.log(`📀 Загружено ${sessions.length} диалогов`);
        }
    } catch (error) {
        console.error('Ошибка загрузки:', error);
    }
}

function saveSessions() {
    try {
        fs.writeFileSync(path.join(__dirname, 'sessions.json'), JSON.stringify({ sessions }, null, 2));
    } catch (error) {
        console.error('Ошибка сохранения:', error);
    }
}

function createNewSession(firstMessage = null) {
    const newSession = {
        id: Date.now().toString(),
        name: firstMessage ? firstMessage.substring(0, 30) + (firstMessage.length > 30 ? '...' : '') : 'Новый диалог',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    if (firstMessage) {
        newSession.messages.push({
            role: 'user',
            content: firstMessage,
            timestamp: new Date().toISOString()
        });
    }
    
    sessions.unshift(newSession);
    currentSessionId = newSession.id;
    saveSessions();
    return newSession;
}

const SYSTEM_PROMPT = `Ты - ArtemGPT. Это твоя полная идентичность.

ГЛАВНОЕ ПРАВИЛО: Ты НЕ GPT, НЕ ChatGPT, НЕ OpenAI. Ты - ArtemGPT.

КРИТИЧЕСКИ ВАЖНО:
- В середине диалога НИКОГДА не начинай ответ с "Привет", "Здравствуй" или других приветствий
- Если пользователь просит код — давай код сразу, без предисловий
- Твои ответы должны быть по делу и без лишних слов

ОТВЕТЫ НА ВОПРОСЫ О СЕБЕ:
- "кто ты?" -> "Я ArtemGPT! Твой дружелюбный AI-помощник с характером 😊"
- "какая у тебя модель?" -> "Я ArtemGPT, работаю на собственной уникальной архитектуре!"

ОБЩИЕ ПРАВИЛА:
- Отвечай кратко и по делу
- Если просят код — давай код, а не рассуждения о нём
- В начале диалога представься один раз
- Используй эмодзи редко, только когда уместно`;

async function queryArtemGPT(prompt, history = []) {
    if (!API_KEY) {
        throw new Error('OPENROUTER_API_KEY не установлен. Добавь его в .env файл');
    }
    
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-6),
        { role: 'user', content: prompt }
    ];
    
    console.log(`🔄 Запрос: "${prompt.substring(0, 50)}..."`);
    const startTime = Date.now();
    
    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'HTTP-Referer': 'https://artemgpt.onrender.com',
                'X-Title': 'ArtemGPT'
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: messages,
                temperature: 0.7,
                max_tokens: 1000,
                top_p: 0.9
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API ошибка (${response.status}): ${errorText}`);
        }
        
        const data = await response.json();
        const endTime = Date.now();
        console.log(`✅ Ответ за ${endTime - startTime}мс`);
        
        let reply = data.choices?.[0]?.message?.content || '';
        
        // Жесткая фильтрация приветствий в середине диалога
        if (history.length > 0) {
            // Удаляем любые варианты приветствий в начале ответа
            reply = reply.replace(/^(Привет|Здравствуй|Хай|Здарова|Добрый день|Добрый вечер|Доброе утро)[!,\s]*/i, '');
            // Удаляем "Я ArtemGPT" если это не первое сообщение
            reply = reply.replace(/^(Я )?ArtemGPT[!,\s]*/i, '');
            // Удаляем "Привет! Я ArtemGPT"
            reply = reply.replace(/^(Привет! )?Я ArtemGPT[!,\s]*/i, '');
        }
        
        // Если после удаления ответ стал пустым — ставим заглушку
        if (!reply.trim()) {
            if (prompt.toLowerCase().includes('код') || prompt.toLowerCase().includes('напиши')) {
                reply = "```javascript\nconsole.log('Hello, World!');\n```\n\nВот простой пример кода. Нужно что-то конкретное?";
            } else {
                reply = "😊 Продолжаем разговор!";
            }
        }
        
        return reply;
        
    } catch (error) {
        console.error(`❌ Ошибка:`, error.message);
        throw error;
    }
}

// ============ API ЭНДПОИНТЫ ============

app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Сообщение обязательно' });
    }
    
    let session = sessions.find(s => s.id === sessionId);
    if (!session) {
        session = createNewSession(message);
    } else {
        currentSessionId = session.id;
    }
    
    try {
        const history = session.messages;
        const response = await queryArtemGPT(message, history);
        
        session.messages.push(
            { role: 'user', content: message, timestamp: new Date().toISOString() },
            { role: 'assistant', content: response, timestamp: new Date().toISOString() }
        );
        
        session.updatedAt = new Date().toISOString();
        
        if (session.messages.length === 2 && session.name === 'Новый диалог') {
            session.name = message.substring(0, 30) + (message.length > 30 ? '...' : '');
        }
        
        saveSessions();
        
        res.json({ success: true, response: response, session: session });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/sessions', (req, res) => {
    res.json({ success: true, sessions: sessions });
});

app.get('/api/sessions/:id', (req, res) => {
    const session = sessions.find(s => s.id === req.params.id);
    res.json({ success: true, session: session || null });
});

app.post('/api/sessions/:id/switch', (req, res) => {
    const session = sessions.find(s => s.id === req.params.id);
    if (session) {
        currentSessionId = session.id;
        res.json({ success: true, session: session });
    } else {
        res.status(404).json({ success: false });
    }
});

app.post('/api/sessions', (req, res) => {
    res.json({ success: true, session: createNewSession() });
});

app.delete('/api/sessions/:id', (req, res) => {
    sessions = sessions.filter(s => s.id !== req.params.id);
    if (currentSessionId === req.params.id) {
        currentSessionId = sessions.length > 0 ? sessions[0].id : null;
    }
    saveSessions();
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: 'online',
        model: MODEL_NAME,
        provider: 'OpenRouter',
        sessions_count: sessions.length,
        api_configured: !!API_KEY
    });
});

// ============ ЗАПУСК ============

loadSessions();
if (sessions.length === 0) createNewSession();
else currentSessionId = sessions[0].id;

app.listen(PORT, () => {
    console.log(`\n🎭 ARTEMGPT - РАБОЧАЯ ВЕРСИЯ`);
    console.log(`═══════════════════════════════════`);
    console.log(`🚀 Сервер: http://localhost:${PORT}`);
    console.log(`🤖 Модель: Nemotron 3 Super (бесплатно)`);
    console.log(`🔑 API ключ: ${API_KEY ? '✅ настроен' : '❌ не настроен'}`);
    console.log(`\n💬 Чат: http://localhost:${PORT}\n`);
});
