const express = require('express');
const cron = require('node-cron');
const app = express();
console.log('Dependencies loaded');
app.use(express.json());

const LINE_TOKEN = process.env.LINE_TOKEN;  // Render Environment Variables

let records = [];

function getMemberName(userId) {
  const FAMILY = {
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',    
  };
  return FAMILY[userId] || userId.slice(-8);
}

// 星期五晚上9點提醒 (Asia/Taipei)
cron.schedule('0 21 * * 5', async () => {
  try {
    await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_TOKEN}`
      },
      body: JSON.stringify({
        messages: [{
          type: 'text',
          text: '記得今晚MARK齊數，陣間要結算啦:)'
        }]
      })
    });
    console.log('Friday reminder sent');
  } catch (error) {
    console.error('Reminder error:', error);
  }
}, {
  timezone: 'Asia/Taipei'
});

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    if (event.type !== 'message' || event.message.type !== 'text') return res.status(200).send('OK');

    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const userId = event.source.userId;
    const memberName = getMemberName(userId);

    if (text === '我的ID') {
      return replyAndEnd(replyToken, `👤 ${memberName}\nID：\`${userId}\``);
    }

    if (text === '記帳清單') {
      if (records.length === 0) {
        return replyAndEnd(replyToken, `${memberName}，目前無記帳記錄！`);
      }
      const total = records.reduce((sum, r) => sum + r.amount, 0);
      const recent = records.slice(-10).map(r => `${r.date.slice(5,10)} ${r.who} ${r.amount}`).join('\n');
      return replyAndEnd(replyToken, `📊 ${memberName}（共 ${total} 元）\n${recent}`);
    }

    if (text === '本月總計') {
      const now = new Date();
      const nowMonth = now.getMonth();
      const nowYear = now.getFullYear();
      
      const monthRecords = records.filter(r => {
        const match = r.date.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!match) return false;
        const year = parseInt(match[1]);
        const month = parseInt(match[2]) - 1;
        return month === nowMonth && year === nowYear;
      });
      
      const monthTotal = monthRecords.reduce((sum, r) => sum + r.amount, 0);
      return replyAndEnd(replyToken, `📅 ${memberName}\n本月：${monthTotal} 元\n${monthRecords.length} 筆`);
    }

   if (text === '本週支出') {
  const now = new Date('Asia/Taipei');
  const dayOfWeek = now.getDay();  // 0=Sun, 6=Sat
  const daysToLastSaturday = dayOfWeek === 0 ? 7 : dayOfWeek + 1;  // 到上週六
  const lastSaturday = new Date(now);
  lastSaturday.setDate(now.getDate() - daysToLastSaturday);
  lastSaturday.setHours(0, 0, 0, 0);
  
  const userRecords = records.filter(r => {
    const rDate = new Date(r.date + ' GMT+0800');
    return rDate >= lastSaturday && r.userId === userId;
  });
  
  const weekTotal = userRecords.reduce((sum, r) => sum + r.amount, 0);
  return replyAndEnd(replyToken, `📈 ${memberName}\n本週（${lastSaturday.toLocaleDateString('zh-TW')}至今）：${weekTotal} 元\n${userRecords.length} 筆`);
}
    if (text === '清空紀錄') {
      records = [];
      return replyAndEnd(replyToken, `🗑️ ${memberName} 已清空所有記錄`);
    }

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
        
        return replyAndEnd(replyToken, `✅ ${memberName}：${category} ${shop || ''}${amount}元`);
      }
    }

    return replyAndEnd(replyToken, `${memberName}\n📝 餐飲 180\n📊 記帳清單\n📅 本月總計\n📈 本週支出\n🗑️ 清空紀錄\n🆔 我的ID`);

  } catch (error) {
    console.error(error);
    res.status(200).send('ERROR');
  }
});

async function replyAndEnd(replyToken, text) {
  await reply(replyToken, text);
}

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

app.get('/', (req, res) => res.send(`Bot 運行中\n記錄：${records.length}`));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bot @ ${port}`));
