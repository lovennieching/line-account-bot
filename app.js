const express = require('express');
const app = express();
app.use(express.json());

const LINE_TOKEN = 'rs1z63zui+VBM34QAuCJMZ5uNv3BcwaGcgc4f0KzApm/F6q1GZd+UtSNnNbSR3QMZhZl0j/+evGxqXrVLf22xahmRhaauuZaaSwr1UTwNluQwFIstmM/dM4W9E/td5+E9APtWkRPc2KlQ9gy0+rTKQdB04t89/1O/w1cDnyilFU=';  // 改這裡

// 記憶體記錄（重啟清空）
let records = [];

// 成員對照表（傳「我的ID」後填入）
function getMemberName(userId) {
  const FAMILY = {
    // 範例，之後填入真實 ID：
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',
  };
  return FAMILY[userId] || userId.slice(-8);  // 預設 ID 後8碼
}

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    
    if (event.type !== 'message' || event.message.type !== 'text') {
      return res.status(200).send('OK');
    }

    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const userId = event.source.userId;
    const memberName = getMemberName(userId);

    // 我的ID
    if (text === '我的ID') {
      await reply(replyToken, `👤 ${memberName}\nID：\`${userId}\``);
      return res.status(200).send('OK');
    }

    // 記帳清單
    if (text === '記帳清單') {
      if (records.length === 0) {
        await reply(replyToken, `${memberName}，目前無記帳記錄！`);
      } else {
        const total = records.reduce((sum, r) => sum + r.amount, 0);
        const recent = records.slice(-10).map(r => 
          `${r.date.slice(5,10)} ${r.who} ${r.category} ${r.amount}元`
        ).join('\n');
        await reply(replyToken, `📊 ${memberName} 查看（共 ${total} 元）\n${recent}`);
      }
      return res.status(200).send('OK');
    }

    // 本月總計
    if (text === '本月總計') {
      const now = new Date();
      const monthTotal = records.filter(r => {
        const date = new Date(r.date);
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }).reduce((sum, r) => sum + r.amount, 0);
      await reply(replyToken, `📅 ${memberName} 本月總花費：${monthTotal} 元\n共 ${records.length} 筆`);
      return res.status(200).send('OK');
    }

    if (text === '所有記錄') {
      const allTotal = records.reduce((sum, r) => sum + r.amount, 0);
      const list = records.map(r => `${r.who}:${r.amount}`).join(', ');
      await reply(replyToken, `總計 ${allTotal} 元\n${list}`);
      return res.status(200).send('OK');
    }

    // 記帳：類別 [店家] 金額
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const category = parts[0];
      const amount = parseFloat(parts[parts.length - 1]);
      
      if (!isNaN(amount) && amount > 0) {
        const shop = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
        const record = {
          who: memberName,
          userId,
          category,
          shop,
          amount,
          date: new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'})
        };
        
        records.push(record);
        if (records.length > 100) records = records.slice(-100);
        
        const msg = `✅ ${memberName} 記：${category} ${shop || ''}${amount}元`;
        await reply(replyToken, msg);
        console.log('記帳：', record);
        return res.status(200).send('OK');
      }
    }

    // 幫助
    await reply(replyToken, 
      `👨‍👩‍👧‍👦 ${memberName} 你好！\n\n` +
      `📝 記帳：『餐飲 180』或『超市 麥當勞 520』\n` +
      `📊 查詢：『記帳清單』『本月總計』\n` +
      `🆔 ID：『我的ID』`
    );
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('錯誤：', error);
    res.status(200).send('ERROR');
  }
});

async function reply(replyToken, text) {
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_TOKEN}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text: text }]
      })
    });
    if (!response.ok) {
      console.error('LINE回覆失敗：', response.status);
    }
  } catch (e) {
    console.error('回覆錯誤：', e);
  }
}

app.get('/', (req, res) => {
  res.send(`家庭記帳 Bot v2\n記錄：${records.length}筆`);
});

app.get('/records', (req, res) => {
  res.json(records);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`家庭記帳 Bot 運行於 port ${port}`);
});
