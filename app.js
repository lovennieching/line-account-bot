const express = require('express');
const cron = require('node-cron');
const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_TOKEN;

let records = [];

function getMemberName(userId) {
  const FAMILY = {
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',    
  };
  return FAMILY[userId] || userId.slice(-8);
}

// 星期五21:00提醒
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
  } catch (e) { 
    console.error('提醒錯誤', e); 
  }
}, { timezone: 'Asia/Taipei' });

// 簡化版文字按鈕（Quick Reply，100%相容）
async function showMenu(replyToken) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${LINE_TOKEN}` 
    },
    body: JSON.stringify({ 
      replyToken, 
      messages: [{
        type: 'text',
        text: '👇 點擊下方按鈕快速操作：',
        quickReply: {
          items: [
            { type: 'action', action: { type: 'message', label: '📝 即時記帳', text: '📝 記帳說明' } },
            { type: 'action', action: { type: 'message', label: '📊 記帳清單', text: '記帳清單' } },
            { type: 'action', action: { type: 'message', label: '📈 本週支出', text: '本週支出' } },
            { type: 'action', action: { type: 'message', label: '🆔 我的ID', text: '我的ID' } },
            { type: 'action', action: { type: 'message', label: '🗑️ 清空紀錄', text: '清空紀錄' } }
          ]
        }
      }]
    })
  });
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

    // 顯示選單
    if (['菜單', '選單', 'menu'].includes(text)) {
      return showMenu(replyToken);
    }

    // 記帳說明
    if (text === '📝 記帳說明') {
      return replyText(replyToken, 
        `${memberName} 記帳教學：\n📝 餐飲 180\n📝 超市 全家 250\n📝 交通 公車 40\n\n記帳後自動回選單！`
      );
    }

    if (text === '我的ID') {
      return replyText(replyToken, `👤 ${memberName}\nID：\`${userId}\``);
    }

    if (text === '記帳清單') {
      if (!records.length) return replyText(replyToken, `${memberName}，目前無記帳記錄！`);
      const total = records.reduce((sum, r) => sum + r.amount, 0);
      const recent = records.slice(-10).map(r => `${r.date.slice(5,10)} ${r.who} ${r.amount}`).join('\n');
      return replyText(replyToken, `📊 ${memberName}（共 ${total} 元）\n${recent}`);
    }

    if (text === '本月總計') {
      const now = new Date();
      const nowMonth = now.getMonth();
      const nowYear = now.getFullYear();
      const monthRecords = records.filter(r => {
        const match = r.date.match(/(\d{4})\/(\d{1,2})/);
        return match && parseInt(match[2]) - 1 === nowMonth && parseInt(match[1]) === nowYear;
      });
      const monthTotal = monthRecords.reduce((sum, r) => sum + r.amount, 0);
      return replyText(replyToken, `📅 ${memberName}\n本月：${monthTotal} 元\n${monthRecords.length} 筆`);
    }

    // ✅ 本週支出：只顯示個人（已修復）
    if (text === '本週支出') {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const lastSaturday = new Date(now);
      lastSaturday.setDate(now.getDate() - (dayOfWeek || 7) + 6);
      lastSaturday.setHours(0, 0, 0, 0);
      
      const userRecords = records.filter(r => {
        const [dateStr] = r.date.split(' ');
        const match = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!match) return false;
        const rDate = new Date(`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
        return rDate >= lastSaturday && r.userId === userId; // 只查個人！
      });
      
      const weekTotal = userRecords.reduce((sum, r) => sum + r.amount, 0);
      return replyText(replyToken, `📈 ${memberName}\n本週（上週六至今）：${weekTotal} 元\n${userRecords.length} 筆`);
    }

    if (text === '清空紀錄') {
      records = [];
      return replyText(replyToken, `🗑️ ${memberName} 已清空所有記錄`);
    }

    // 記帳邏輯
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const category = parts[0];
      const amount = parseFloat(parts[parts.length - 1]);
      if (!isNaN(amount) && amount > 0) {
        const shop = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
        const record = {
          who: memberName,
          userId, // 關鍵：儲存 userId 用來過濾個人資料
          category, 
          shop, 
          amount,
          date: new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'})
        };
        records.push(record);
        if (records.length > 100) records = records.slice(-100);
        return replyText(replyToken, `✅ ${memberName}：${category} ${shop || ''}${amount}元`);
      }
    }

    // 預設顯示選單
    return showMenu(replyToken);

  } catch (error) {
    console.error('Webhook 錯誤：', error);
    res.status(200).send('ERROR');
  }
});

// 簡化回覆函數
async function replyText(replyToken, text) {
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
