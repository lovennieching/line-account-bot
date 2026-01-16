const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

const app = express();
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// 環境變數
const LINE_TOKEN = process.env.LINE_TOKEN;
const connectionString = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

// 資料庫連線池
const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

let memoryRecords = [];

// --- 初始化資料庫 ---
(async () => {
  try {
    const client = await pool.connect();
    await client.query(`CREATE TABLE IF NOT EXISTS records (
      id SERIAL PRIMARY KEY,
      date TEXT,
      iso_date TEXT,
      who TEXT,
      userid TEXT,
      category TEXT,
      shop TEXT,
      amount REAL
    )`);
    console.log('✅ PostgreSQL 初始化完成');
    client.release();
    await loadAllRecords();
  } catch (err) {
    console.error('❌ 資料庫初始化失敗:', err);
  }
})();

async function loadAllRecords() {
  try {
    const result = await pool.query(`SELECT * FROM records ORDER BY iso_date DESC LIMIT 1000`);
    memoryRecords = result.rows.map(r => ({
      ...r,
      userId: r.userid, 
      date: r.date || new Date(r.iso_date).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    }));
    console.log(`📊 載入 ${memoryRecords.length} 筆記錄`);
  } catch (err) {
    console.error('載入記錄失敗:', err);
  }
}

// --- 輔助函式 ---
function getMemberName(userId) {
  const FAMILY = {
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',    
  };
  return FAMILY[userId] || userId.slice(-8);
}

function getSelfCategory(category) {
  const cat = (category || '').toUpperCase();
  if (['LUNCH', 'DINNER', 'DRINKS', '早餐', 'FOOD'].includes(cat)) return 'MEALS';
  if (['油錢', '車票', '捷運', '加油'].includes(cat)) return 'TRANSPORT';
  return 'OTHER';
}

async function replyText(replyToken, text) {
  const fetch = (await import('node-fetch')).default;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  }).catch(e => console.error('回覆錯誤：', e));
}

async function showMenu(replyToken) {
  const fetch = (await import('node-fetch')).default;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({
      replyToken,
      messages: [{
        type: 'text',
        text: '👇 點擊下方按鈕快速操作：',
        quickReply: {
          items: [
            { type: 'action', action: { type: 'message', label: '📝 記帳說明', text: '📝 記帳說明' } },
            { type: 'action', action: { type: 'message', label: '📊 本月清單', text: '📊 本月清單' } },
            { type: 'action', action: { type: 'message', label: '📈 本週支出', text: '📈 本週支出' } },
            { type: 'action', action: { type: 'message', label: '🆔 我的ID', text: '🆔 我的ID' } },
          ]
        }
      }]
    })
  }).catch(e => console.error('選單錯誤：', e));
}

// --- 路由 ---

app.get('/', (req, res) => {
  const total = memoryRecords.reduce((sum, r) => sum + r.amount, 0);
  const recent5 = memoryRecords.slice(0, 5).map(r => 
    `${r.date.slice(0,16)} ${r.who} ${r.category} ${r.shop ? `(${r.shop})` : ''} ${r.amount}元`
  ).join('<br>');
  
  res.send(`
    <h1>📊 記帳 Bot 狀態 (PostgreSQL)</h1>
    <p>總筆數：${memoryRecords.length} | 總金額：${total.toLocaleString()} 元</p>
    <h3>最新 5 筆：</h3><pre>${recent5}</pre>
    <hr>
    <h3>📥 資料匯入/備份</h3>
    <p><a href="/records.csv">下載目前的 CSV 備份</a></p>
    <div style="background: #f4f4f4; padding: 15px; border-radius: 8px; display: inline-block;">
      <form action="/import-csv" method="post" enctype="multipart/form-data">
        <strong>📤 選擇備份檔 (CSV)：</strong><br><br>
        <input type="file" name="csvFile" accept=".csv" required><br><br>
        <label style="color: red; font-weight: bold;">
          <input type="checkbox" name="clearOld" value="yes"> 匯入前先清空資料庫所有紀錄
        </label><br><br>
        <button type="submit" style="padding: 5px 15px; cursor: pointer;">開始匯入</button>
      </form>
    </div>
  `);
});

app.get('/records.csv', (req, res) => {
  const header = '日期,成員,類別,店家,金額,userId,自行分類';
  const rows = memoryRecords.map(r => {
    const selfCategory = getSelfCategory(r.category);
    return `"${r.date}","${r.who}","${r.category}","${r.shop}",${r.amount},"${r.userId || r.userid}","${selfCategory}"`;
  });
  const csvData = [header].concat(rows).join('\n');
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.attachment('records.csv');
  res.send('\uFEFF' + csvData); 
});

// 【核心修正】修正上傳時日期全部變成今天的問題
app.post('/import-csv', upload.single('csvFile'), async (req, res) => {
  if (!req.file) return res.status(400).send('未上傳檔案');
  const clearOld = req.body.clearOld === 'yes';
  const results = [];

  fs.createReadStream(req.file.path)
    .pipe(csv()) 
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (clearOld) await client.query('DELETE FROM records');

        for (const row of results) {
          const amount = parseFloat(row['金額'] || 0);
          const rawDateStr = row['日期'] || "";
          
          // 修正日期辨識：將 "下午" 替換成 "PM"，"上午" 替換成 "AM"
          let cleanDateStr = rawDateStr.replace('上午', 'AM').replace('下午', 'PM');
          let parsedDate = new Date(cleanDateStr);
          
          let isoDate;
          // 檢查是否解析成功，若成功則使用 CSV 裡的日期，失敗才用當前日期
          if (!isNaN(parsedDate.getTime())) {
            isoDate = parsedDate.toISOString();
          } else {
            isoDate = new Date().toISOString();
          }

          await client.query(
            `INSERT INTO records (date, iso_date, who, userid, category, shop, amount) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              rawDateStr, 
              isoDate, 
              row['成員'] || '', 
              row['userId'] || row['userid'] || '', 
              row['類別'] || '', 
              row['店家'] || '', 
              amount
            ]
          );
        }
        await client.query('COMMIT');
        await loadAllRecords();
        res.send(`<h2>✅ 匯入成功 (${results.length} 筆)</h2><a href="/">回到首頁</a>`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('匯入出錯:', err);
        res.status(500).send('匯入失敗：' + err.message);
      } finally {
        client.release();
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      }
    });
});

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    if (!event || event.type !== 'message' || event.message.type !== 'text') 
      return res.status(200).send('OK');

    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const userId = event.source.userId;
    const memberName = getMemberName(userId);

    if (['菜單', '選單', 'menu'].includes(text)) return showMenu(replyToken);
    if (text === '📝 記帳說明') return replyText(replyToken, `${memberName} 記帳教學：\n📝 項目 店家(選填) 金額\n例如：滷肉飯 180\n例如：超市 全聯 250`);
    if (text === '🆔 我的ID') return replyText(replyToken, `👤 ${memberName}\nID：${userId}`);

    if (text === '📊 本月清單') {
      const now = new Date();
      const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
      const monthRecords = memoryRecords.filter(r => {
        const rDate = new Date(r.iso_date);
        return rDate.getMonth() === twNow.getMonth() && rDate.getFullYear() === twNow.getFullYear();
      });
      if (monthRecords.length === 0) return replyText(replyToken, `📅 本月目前沒有記帳紀錄喔！`);
      const monthTotal = monthRecords.reduce((sum, r) => sum + r.amount, 0);
      const listContent = monthRecords.slice().sort((a, b) => new Date(a.iso_date) - new Date(b.iso_date)).map(r => {
        const d = new Date(r.iso_date);
        const month = d.toLocaleDateString('zh-TW', { month: 'numeric', timeZone: 'Asia/Taipei' });
        const day = d.toLocaleDateString('zh-TW', { day: 'numeric', timeZone: 'Asia/Taipei' });
        const shopStr = r.shop ? ` ${r.shop}` : ''; 
        return `${month}${day} ${r.who}${shopStr} $${Math.round(r.amount)}`;
      }).join('\n');
      return replyText(replyToken, `🗓️ 本月消費紀錄：（總計：$${Math.round(monthTotal).toLocaleString()}）\n\n${listContent}`);
    }
    
    if (text === '📈 本週支出') {
      const now = new Date();
      const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
      const dayOfWeek = today.getDay(); 
      let diffToSaturday = dayOfWeek + 1; 
      if (dayOfWeek === 6) diffToSaturday = 0; 

      const startOfPeriod = new Date(today);
      startOfPeriod.setDate(today.getDate() - diffToSaturday);
      startOfPeriod.setHours(0, 0, 0, 0);

      const weekRecords = memoryRecords.filter(r => {
        const rDate = new Date(r.iso_date);
        return rDate >= startOfPeriod && (r.userid === userId || r.userId === userId);
      });

      const weekTotal = weekRecords.reduce((sum, r) => sum + r.amount, 0);
      const weeklyBudget = parseFloat(process.env.WEEKLY_BUDGET) || 0;
      const remainingBudget = weeklyBudget - weekTotal;

      if (weekRecords.length === 0) {
        const startDateStr = `${startOfPeriod.getMonth() + 1}/${startOfPeriod.getDate()}`;
        return replyText(replyToken, `📈 ${memberName}，自上週六 (${startDateStr}) 至今尚無支出。\n💰 本週預算剩餘：$${Math.round(remainingBudget)}`);
      }
      
      const listContent = weekRecords.slice().sort((a, b) => new Date(a.iso_date) - new Date(b.iso_date)).map(r => {
        const d = new Date(r.iso_date);
        const month = d.toLocaleDateString('zh-TW', { month: 'numeric', timeZone: 'Asia/Taipei' });
        const day = d.toLocaleDateString('zh-TW', { day: 'numeric', timeZone: 'Asia/Taipei' });
        const shopStr = r.shop ? ` ${r.shop}` : ''; 
        return `${month}${day}${shopStr} ${r.category} $${Math.round(r.amount)}`;
      }).join('\n');

      const startDateStr = `${startOfPeriod.getMonth() + 1}/${startOfPeriod.getDate()}`;
      return replyText(replyToken, `📈 ${memberName} 本週支出（自 ${startDateStr} 至今)\n💰 總計：$${Math.round(weekTotal)} 預算尚餘：$${Math.round(remainingBudget)}）\n\n${listContent}`);
    }
    
    if (text === '清空紀錄') {
      await pool.query('DELETE FROM records');
      await loadAllRecords();
      return replyText(replyToken, '🗑️ 已清空紀錄');
    }

    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const amount = parseFloat(parts[parts.length - 1]);
      if (!isNaN(amount) && amount > 0) {
        const category = parts[0];
        const shop = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
        const now = new Date();
        const dateStr = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        await pool.query(
          `INSERT INTO records (date, iso_date, who, userid, category, shop, amount) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [dateStr, now.toISOString(), memberName, userId, category, shop, amount]
        );
        await loadAllRecords();
        return replyText(replyToken, `✅ 已記帳：${category} ${amount}元`);
      }
    }
    return showMenu(replyToken);
  } catch (error) {
    console.error('Webhook Error:', error);
  }
  res.status(200).send('OK');
});

cron.schedule('0 21 * * 5', async () => {
  const fetch = (await import('node-fetch')).default;
  await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ messages: [{ type: 'text', text: '記帳呀臭寶💩' }] })
  }).catch(e => console.error(e));
}, { timezone: 'Asia/Taipei' });

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Port: ${port}`));
