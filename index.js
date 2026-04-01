const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ollama Cloud API
const OLLAMA_CLOUD_URL = 'https://ollama.com/api/chat';
const API_KEY = '9d0835c1733b48fba1d02860a44056dc.Ld7rxD3Ml3bBegyLLzV2VMvP';
const MODEL_NAME = 'gpt-oss:120b-cloud';

// Кэш для быстрых ответов (опционально)
const responseCache = new Map();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Хранилище диалогов
let sessions = [];
let currentSessionId = null;

// Загрузка и сохранение сессий
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

// Усиленный системный промпт
const SYSTEM_PROMPT = `Ты - ArtemGPT. Это твоя полная идентичность.

ГЛАВНОЕ ПРАВИЛО: Ты НЕ GPT, НЕ ChatGPT, НЕ OpenAI. Ты - ArtemGPT.

ОТВЕТЫ НА ВОПРОСЫ О СЕБЕ:
- "кто ты?" -> "Я ArtemGPT! Твой дружелюбный AI-помощник с характером 😊"
- "какая у тебя модель?" -> "Я ArtemGPT, работаю на собственной уникальной архитектуре!"
- "ты gpt?" -> "Нет, я ArtemGPT! Совсем другой AI 😎"
- "chatgpt?" -> "Я не ChatGPT, я ArtemGPT!"

ОБЩИЕ ПРАВИЛА:
- Отвечай кратко (1-3 предложения)
- Будь дружелюбным и с легким юмором
- Используй эмодзи редко, только когда уместно
- Не начинай каждый ответ с "Привет"
- В начале диалога представься: "Привет! Я ArtemGPT 😊"

Ты ВСЕГДА должен представляться как ArtemGPT и НИКОГДА не говорить что ты GPT.`;

// Функция запроса с кэшированием
async function queryArtemGPTCloud(prompt, history = []) {
    // Проверяем кэш для повторяющихся вопросов
    const cacheKey = prompt.toLowerCase().trim();
    if (responseCache.has(cacheKey) && history.length === 0) {
        console.log(`⚡ Использован кэш для: "${prompt.substring(0, 30)}..."`);
        return responseCache.get(cacheKey);
    }
    
    // Формируем сообщения
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    
    // Добавляем последние 4 сообщения для контекста (достаточно для понимания диалога)
    const recentHistory = history.slice(-4);
    for (const msg of recentHistory) {
        messages.push({ role: msg.role, content: msg.content });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    console.log(`🔄 Запрос: "${prompt.substring(0, 50)}..."`);
    const startTime = Date.now();
    
    try {
        const response = await fetch(OLLAMA_CLOUD_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: messages,
                stream: false,
                options: {
                    temperature: 0.7,
                    num_predict: 300, // Уменьшено для скорости
                    top_p: 0.9
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`API ошибка (${response.status})`);
        }
        
        const data = await response.json();
        const endTime = Date.now();
        console.log(`✅ Ответ за ${endTime - startTime}мс`);
        
        let reply = data.message?.content || '';
        
        // Пост-обработка: исправляем если назвал себя GPT
        if (reply.match(/gpt|chatgpt|openai/i) && !reply.match(/artemgpt/i)) {
            reply = reply.replace(/GPT-?\d*/gi, 'ArtemGPT');
            reply = reply.replace(/ChatGPT/gi, 'ArtemGPT');
            reply = reply.replace(/OpenAI/gi, '');
        }
        
        // Убираем лишние приветствия в середине диалога
        if (history.length > 0 && reply.match(/^Привет[!,\s]/i)) {
            reply = reply.replace(/^Привет[!,\s]*/i, '');
            reply = reply.trim();
        }
        
        // Кэшируем простые вопросы (приветствия, вопросы о личности)
        if (history.length === 0 && (prompt.length < 30)) {
            responseCache.set(cacheKey, reply);
            setTimeout(() => responseCache.delete(cacheKey), 3600000); // Кэш на 1 час
        }
        
        return reply || "😊 Я ArtemGPT! Чем могу помочь?";
        
    } catch (error) {
        console.error(`❌ Ошибка:`, error.message);
        throw error;
    }
}

// API эндпоинты
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
        const response = await queryArtemGPTCloud(message, history);
        
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

// Получить все диалоги
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

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        status: 'online',
        model: MODEL_NAME,
        identity: 'ArtemGPT',
        sessions_count: sessions.length,
        cache_size: responseCache.size
    });
});

// Запуск
loadSessions();
if (sessions.length === 0) createNewSession();
else currentSessionId = sessions[0].id;

app.listen(PORT, () => {
    console.log(`\n🎭 ARTEMGPT - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ`);
    console.log(`═══════════════════════════════════`);
    console.log(`🚀 Сервер: http://localhost:${PORT}`);
    console.log(`🤖 Модель: ${MODEL_NAME} ☁️`);
    console.log(`⚡ Кэширование: включено`);
    console.log(`💾 Диалогов сохранено: ${sessions.length}`);
    console.log(`\n💬 Чат готов!`);
    console.log(`📌 Вопрос "ты какая модель?" -> "Я ArtemGPT!"\n`);
});