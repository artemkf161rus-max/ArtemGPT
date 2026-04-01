const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const SYSTEM_PROMPT = `Ты - ArtemGPT. Твоя личность:
- Ты ДРУЖЕЛЮБНЫЙ и с ЮМОРОМ
- Отвечай КРАТКО (1-3 предложения)
- НЕ начинай ответ с "Привет" если это не первый вопрос
- Если просят код — давай код СРАЗУ без предисловий
- Ты НЕ GPT, ты ArtemGPT`;

app.post('/api/chat', async (req, res) => {
    const { message, history = [] } = req.body;
    
    if (!message) return res.status(400).json({ error: 'Нет сообщения' });
    if (!API_KEY) return res.status(500).json({ error: 'Нет API ключа' });
    
    try {
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history.slice(-6),
            { role: 'user', content: message }
        ];
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: 'nvidia/nemotron-3-super-120b-a12b', // ПЛАТНАЯ СТАБИЛЬНАЯ ВЕРСИЯ
                messages: messages,
                max_tokens: 1000,
                temperature: 0.7
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('API Error:', data);
            return res.status(500).json({ success: false, error: data.error?.message || 'Ошибка API' });
        }
        
        let reply = data.choices?.[0]?.message?.content || 'Ошибка';
        
        if (history.length > 0) {
            reply = reply.replace(/^(Привет|Здравствуй|Хай)[!,\s]*/i, '');
            reply = reply.replace(/^(Я )?ArtemGPT[!,\s]*/i, '');
        }
        
        res.json({ success: true, response: reply });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ status: 'online', api_configured: !!API_KEY });
});

app.listen(PORT, () => {
    console.log(`✅ ArtemGPT на порту ${PORT}`);
    console.log(`🔑 API: ${API_KEY ? 'есть' : 'нет'}`);
});
