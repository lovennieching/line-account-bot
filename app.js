const express = require('express');
const app = express();
app.use(express.json());

const LINE_TOKEN = 'rs1z63zui+VBM34QAuCJMZ5uNv3BcwaGcgc4f0KzApm/F6q1GZd+UtSNnNbSR3QMZhZl0j/+evGxqXrVLf22xahmRhaauuZaaSwr1UTwNluQwFIstmM/dM4W9E/td5+E9APtWkRPc2KlQ9gy0+rTKQdB04t89/1O/w1cDnyilFU=';  // 改這裡

// 記憶體記錄（重啟清空，重啟後用 Google Sheet）
let records = [];

// 家庭成員對照（之後填入真實 userId）
const FAMILY = {
  // 'U1234567890abcdef': '葉大屁',
  // 'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',
  // 群組會自動用 displayName
};

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    
    // 只處理文字訊息
    if (event.type !== 'message' || event.message.type !== 'text') {
      return res.status(200).send('OK');
    }

    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const userId = event.source.userId;
    const userName = event.source.userProfile?.displayName || '家人';

  // 顯示 userId 指令
  if (text === '我的ID') {
    await reply(replyToken, `👤 ${userName}\nID：\`${userId}\``);
    return res.status(200).send('OK');
  }
    
    // 查詢指令
    if (text === '記帳清單') {
      if (records.length === 0) {
        await reply(replyToken, `${userName}，目前無記帳記錄！\n傳『餐飲 180』開始記帳`);
      } else {
        const total = records.reduce((sum, r) => sum + r.amount, 0);
        const recent = records.slice(-10).map(r => 
          `${r.date.slice(5,10)} ${r.who} ${r.category} ${r.amount}`
        ).join('\n');
        await reply(replyToken, `📊 ${userName} 的記帳（共 ${total} 元）\n${recent}`);
      }
      return res.status(200).send('OK');
    }

    // 本月總計（簡化版）
    if (text === '本月總計') {
      const thisMonth = records.filter(r => 
        new Date(r.date).getMonth() === new Date().getMonth()
      );
      const monthTotal = thisMonth.reduce((sum, r) => sum + r.amount, 0);
      await reply(replyToken, `📅 本月總花費：${monthTotal} 元\n共 ${thisMonth.length} 筆`);
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
          who: userName,
          userId,
          category,
          shop,
          amount,
          date: new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'})
        };
        
        records.push(record);
        // 只保留最近 100 筆
        if (records.length > 100) records = records.slice(-100);
        
        const msg = `✅ ${userName} 記帳成功！\n${category} ${shop || ''}${amount}元`;
        await reply(replyToken, msg);
        console.log('記帳：', record);
      } else {
        await reply(replyToken, `${userName}\n格式：類別 [店家] 金額\n例：餐飲 麥當勞 180 或 餐飲 180`);
      }
    } else {
      await reply(replyToken, `${userName}\n📝 家庭記帳 Bot\n\n記帳：『餐飲 180』\n查詢：『記帳清單』『本月總計』`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('錯誤：', error);
    res.status(200).send('ERROR');
  }
});

async function reply(replyToken, text) {
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_TOKEN}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }]
      })
    });
  } catch (e) {
    console.error('回覆錯誤：', e);
  }
}

app.get('/', (req, res) => {
  res.send(`家庭記帳 Bot 運行中\n記錄數：${records.length}`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`家庭記帳 Bot 運行於 ${port}`);
});
