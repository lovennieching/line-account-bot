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

// 星期五提醒
cron.schedule('0 21 * * 5', async () => {
  try {
    await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ messages: [{ type: 'text', text: '記得今晚MARK齊數，陣間要結算啦:)' }] })
    });
  } catch (e) { console.error('提醒錯誤', e); }
}, { timezone: 'Asia/Taipei' });

function sendButtons(replyToken, memberName) {
  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({
      replyToken,
      messages: [{
        type: 'flex',
        altText: '記帳選單',
        contents: {
          type: 'bubble',
          hero: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: `${memberName} 記帳Bot`, weight: 'bold', size: 'lg' }] },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'button', action: { type: 'postback', label: '📝 即時記帳', data: 'action=記帳' }, style: 'primary' },
              { type: 'button', action: { type: 'postback', label: '📊 記帳清單', data: 'action=清單' }, style: 'secondary' },
              { type: 'button', action: { type: 'postback', label: '📅 本月總計', data: 'action=本月' }, style: 'secondary' },
              { type: 'button', action: { type: 'postback', label: '📈 本週支出', data: 'action=本週' }, style: 'secondary' }
            ]
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              { type: 'button', action: { type: 'postback', label: '🗑️ 清空紀錄', data: 'action=清空' }, style: 'warning', color: '#FF6B35' },
              { type: 'button', action: { type: 'postback', label: '🆔 我的ID', data: 'action=ID' }, style: 'secondary' }
            ]
          }
        }
      }]
    })
  };
}

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    const userId = event.source.userId;
    const memberName = getMemberName(userId);

    // Postback 按鈕
    if (event.type === 'postback') {
      const action = event.postback.data.split('=')[1];
      const replyToken = event.replyToken;
      
      switch (action) {
        case '記帳': return replyAndEnd(replyToken, `${memberName}\n📝 輸入：餐飲 180\n或：超市 全家 250`);
        case '清單': {
          if (!records.length) return replyAndEnd(replyToken, `${memberName}，目前無記帳記錄！`);
          const total = records.reduce((sum, r) => sum + r.amount, 0);
          const recent = records.slice(-10).map(r => `${r.date.slice(5,10)} ${r.who} ${r.amount}`).join('\n');
          return replyAndEnd(replyToken, `📊 ${memberName}（共 ${total} 元）\n${recent}`);
        }
        case '本月': {
          const now = new Date();
          const monthRecords = records.filter(r => {
            const match = r.date.match(/(\d{4})\/(\d{1,2})/);
            return match && parseInt(match[2]) - 1 === now.getMonth() && parseInt(match[1]) === now.getFullYear();
          });
          const monthTotal = monthRecords.reduce((sum, r) => sum + r.amount, 0);
          return replyAndEnd(replyToken, `📅 ${memberName}\n本月：${monthTotal} 元\n${monthRecords.length} 筆`);
        }
        case '本週': {
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
            return rDate >= lastSaturday && r.userId === userId;
          });
          
          const weekTotal = userRecords.reduce((sum, r) => sum + r.amount, 0);
          return replyAndEnd(replyToken, `📈 ${memberName}\n本週（上週六至今）：${weekTotal} 元\n${userRecords.length} 筆`);
        }
        case '清空':
          records = [];
          return replyAndEnd(replyToken, `🗑️ ${memberName} 已清空所有記錄`);
        case 'ID':
          return replyAndEnd(r
