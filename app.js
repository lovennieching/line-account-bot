const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_TOKEN;
const db = new sqlite3.Database('records.db');
let memoryRecords = [];

// 初始化資料庫
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    iso_date TEXT,
    who TEXT,
    userId TEXT,
    category TEXT,
    shop TEXT,
    amount REAL
  )`);
  console.log('✅ SQLite 初始化完成');
  loadAllRecords();
});

async function loadAllRecords() {
  return new Promise((resolve) => {
    db.all(`SELECT * FROM records ORDER BY iso_date DESC LIMIT 1000`, (err, rows) => {
      if (!err) {
        memoryRecords = rows.map(r => ({
          ...r,
          date: r.date || new Date(r.iso_date).toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'})
        }));
        console.log(`📊 載入 ${memoryRecords.length} 筆記錄`);
      }
      resolve();
    });
  });
}

async function addRecord(memberName, userId, category, shop, amount) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const stmtDate = now.toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});
    const isoDate = now.toISOString();
    
    db.run(`INSERT INTO records (date, iso_date, who, userId, category, shop, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [stmtDate, isoDate, memberName, userId, category, shop || '', amount],
      function(err) {
        if (err) {
          console.error('DB寫入錯誤：', err);
          reject(err);
        } else {
          const record = { 
            id: this.lastID, 
            date: stmtDate, 
            iso_date: isoDate, 
            who: memberName, 
            userId, 
            category, 
            shop: shop || '', 
            amount 
          };
          memoryRecords.unshift(record);
          if (memoryRecords.length > 1000) memoryRecords = memoryRecords.slice(0, 1000);
          console.log(`✅ 新增：${memberName} ${category} ${amount}元`);
          resolve();
        }
      }
    );
  });
}

function getMemberName(userId) {
  const FAMILY = {
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',    
  };
  return FAMILY[userId] || userId.slice(-8);
}

async function replyText(replyToken, text) {
  const fetch = (await import('node-fetch')).default;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${LINE_TOKEN}` 
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  }).catch(e => console.error('回覆錯誤：', e));
}

async function showMenu(replyToken) {
  const fetch = (await import('node-fetch')).default;
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
    { type: 'action', action: { type: 'message', label: '🗑️ 清空紀錄', text: '🗑️ 清空紀錄' } }  // 🔥 新增這行
  ]
}
      }]
    })
  }).catch(e => console.error('選單錯誤：', e));
}

// 星期五晚上9點全群提醒
cron.schedule('0 21 * * 5', async () => {
  const fetch = (await import('node-fetch')).default;
  await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ 
      messages: [{ type: 'text', text: '記得今晚MARK齊數，陣間要結算啦:)' }] 
    })
  }).catch(e => console.error('提醒錯誤', e));
}, { timezone: 'Asia/Taipei' });

// ✅ 修復後的完整 webhook（第193行問題已解決）
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    if (event.type !== 'message' || event.message.type !== 'text') 
      return res.status(200).send('OK');

    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const userId = event.source.userId;
    const memberName = getMemberName(userId);

    if (['菜單', '選單', 'menu'].includes(text)) return showMenu(replyToken);
    
    if (text === '📝 記帳說明') 
      return replyText(replyToken, `${memberName} 記帳教學：\n📝 餐飲 180\n📝 超市 全家 250\n記帳後自動回選單！`);
    
    if (text === '我的ID') 
      return replyText(replyToken, `👤 ${memberName}\nID：\`${userId}\``);

    if (text === '記帳清單') {
      if (!memoryRecords.length) return replyText(replyToken, `${memberName}，目前無記帳記錄！`);
      const total = memoryRecords.reduce((sum, r) => sum + r.amount, 0);
      const recent = memoryRecords.slice(0, 10).map(r => `${r.date.slice(5,10)} ${r.who} ${r.amount}`).join('\n');
      return replyText(replyToken, `📊 ${memberName}（共 ${total.toLocaleString()} 元）\n${recent}`);
    }

    if (text === '本週支出') {
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);  // 週一開始
      startOfWeek.setHours(0, 0, 0, 0);
      
      const userRecords = memoryRecords.filter(r => {
        const dateMatch = r.date.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!dateMatch) return false;
        const [, year, month, day] = dateMatch;
        const rDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        rDate.setHours(0, 0, 0, 0);
        return rDate >= startOfWeek && r.userId === userId;  // 只算個人
      });
      
      const weekTotal = userRecords.reduce((sum, r) => sum + r.amount, 0);
      return replyText(replyToken, `📈 ${memberName}\n本週（${startOfWeek.toLocaleDateString('zh-TW')}至今）：${weekTotal.toLocaleString()} 元\n${userRecords.length} 筆`);
    }

if (text === '🗑️ 清空紀錄') {
  memoryRecords = [];
  db.exec('DELETE FROM records', () => {
    replyText(replyToken, `${memberName} 已清空所有記錄！`);
  });
  return;
}
    
    // 記帳語法：類別 [店家] 金額
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const category = parts[0];
      const amount = parseFloat(parts[parts.length - 1]);
      if (!isNaN(amount) && amount > 0) {
        const shop = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
        await addRecord(memberName, userId, category, shop, amount);
        return replyText(replyToken, `✅ ${memberName}：${category} ${shop || ''}${amount.toLocaleString()}元\n👇 繼續記帳或點選單`);
      }
    }

    return showMenu(replyToken);
  } catch (error) {
    console.error('Webhook錯誤：', error);
    res.status(200).send('OK');
  }
});

app.get('/', (req, res) => {
  const total = memoryRecords.reduce((sum, r) => sum + r.amount, 0);
  const recent5 = memoryRecords.slice(0, 5).map(r => 
    `${r.date.slice(0,16)} ${r.who} ${r.category} ${r.shop ? `(${r.shop})` : ''} ${r.amount}元`
  ).join('<br>');
  
  res.send(`<h1>📊 記帳 Bot 狀態 (SQLite)</h1>
    <p>總筆數：${memoryRecords.length} | 總金額：${total.toLocaleString()} 元</p>
    <h3>最新 5 筆：</h3><pre>${recent5}</pre>
    <p><a href="/records.csv">下載 CSV</a></p>`);
});

app.get('/records.csv', (req, res) => {
  const csv = ['日期,成員,類別,店家,金額,userId'].concat(
    memoryRecords.map(r => `"${r.date}","${r.who}","${r.category}","${r.shop}",${r.amount},${r.userId}`)
  ).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment('records.csv');
  res.send(csv);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Bot 運行於 port ${port}`));
