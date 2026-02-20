require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const multer = require('multer');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

app.use(express.json({ limit: '50mb' })); 
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1" 
});

const ACTIVE_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send({ error: 'No file' });
    res.json({ filePath: `/uploads/${req.file.filename}` });
});

app.post('/chat', async (req, res) => {
    const { history } = req.body;
    const formattedMessages = history.map(msg => {
        if (msg.img) {
            return {
                role: "user",
                content: [
                    { type: "text", text: msg.content || "Analyze this image." },
                    { type: "image_url", image_url: { url: msg.img } }
                ]
            };
        }
        return { role: msg.role, content: msg.content };
    });

    try {
        const completion = await groq.chat.completions.create({
            model: ACTIVE_VISION_MODEL, 
            messages: [{ role: "system", content: "You are AURA. Lamar is the user. Stay sleek." }, ...formattedMessages],
        });
        res.json({ text: completion.choices[0].message.content });
    } catch (error) {
        res.status(400).json({ text: `AURA Link Error: ${error.message}` });
    }
});

app.listen(3000, () => console.log(`🚀 AURA ONLINE: http://localhost:3000`));