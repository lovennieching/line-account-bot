const express = require('express');
const app = express();
app.use(express.json());

const LINE_TOKEN = 'rs1z63zui+VBM34QAuCJMZ5uNv3BcwaGcgc4f0KzApm/F6q1GZd+UtSNnNbSR3QMZhZl0j/+evGxqXrVLf22xahmRhaauuZaaSwr1UTwNluQwFIstmM/dM4W9E/td5+E9APtWkRPc2KlQ9gy0+rTKQdB04t89/1O/w1cDnyilFU=';  // 改這裡

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    if (event.type !== 'message' || event.message.type !== 'text') {
      return res.status(200).send('OK');
    }

    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const parts = text.replace(/\s+/g, ' ').split(' ');

    if (parts.length < 3) {
      await reply(replyToken, '格式：類別 店家 金額\n例：餐飲 麥當勞 180');
    } else {
      const category = parts[0];
      const shop = parts[1];
      const amount = parseFloat(parts[2]);
      
      if (isNaN(amount) || amount <= 0) {
        await reply(replyToken, '金額錯誤');
      } else {
        await reply(replyToken, `✅ 已記帳：${category}/${shop}/${amount}元`);
      }
    }
    
    res.status(200).send('OK');
  } catch (e) {
    console.error(e);
    res.status(200).send('ERROR');
  }
});

async function reply(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{type: 'text', text}]
    })
  });
}

app.get('/', (req, res) => res.send('記帳 Bot OK'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('運行中'));
