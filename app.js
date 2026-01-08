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
    // 這裡將欄位名稱統一為小寫 userid 以避免 PostgreSQL 大小寫問題
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
      // 確保 memoryRecords 中的 key 是 userId，方便後續程式碼讀取
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
            { type: 'action', action: { type: 'message', label: '📝 即時記帳', text: '📝 記帳說明' } },
            { type: 'action', action: { type: 'message', label: '📊 記帳清單', text: '記帳清單' } },
            { type: 'action', action: { type: 'message', label: '📈 本週支出', text: '本週支出' } },
            { type: 'action', action: { type: 'message', label: '🆔 我的ID', text: '我的ID' } },
            { type: 'action', action: { type: 'message', label: '🗑️ 清空紀錄', text: '🗑️ 清空紀錄' } }
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
  // 修正：確保讀取 memoryRecords 時使用正確的 key
  const csvData = ['日期,成員,類別,店家,金額,userId'].concat(
    memoryRecords.map(r => `"${r.date}","${r.who}","${r.category}","${r.shop}",${r.amount},"${r.userId || r.userid}"`)
  ).join('\n');
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.attachment('records.csv');
  res.send('\uFEFF' + csvData); 
});

app.post('/import-csv', upload.single('csvFile'), async (req, res) => {
  if (!req.file) return res.status(400).send('未上傳檔案');
  const clearOld = req.body.clearOld === 'yes';
  const results = [];

  fs.createReadStream(req.file.path)
    .pipe(csv(['日期', '成員', '類別', '店家', '金額', 'userId']))
    .on('data', (data) => {
      if (data['日期'] === '日期' || !data['金額']) return;
      results.push(data);
    })
    .on('end', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (clearOld) await client.query('DELETE FROM records');
        
        for (const row of results) {
          const amount = parseFloat(row['金額']);
          // 容錯：若 CSV 日期解析失敗則用現在
          let isoDate;
          try { isoDate = new Date(row['日期']).toISOString(); } catch(e) { isoDate = new Date().toISOString(); }
          
          await client.query(
            `INSERT INTO records (date, iso_date, who, userid, category, shop, amount) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [row['日期'], isoDate, row['成員'], row['userId'], row['類別'], row['店家'] || '', amount]
          );
        }
        await client.query('COMMIT');
        fs.unlinkSync(req.file.path);
        await loadAllRecords();
        res.send(`<h2>✅ 匯入成功 (${results.length} 筆)</h2><a href="/">回到首頁</a>`);
      } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).send('錯誤：' + err.message);
      } finally {
        client.release();
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
    if (text === '📝 記帳說明') return replyText(replyToken, `${memberName} 記帳教學：\n📝 餐飲 180\n📝 超市 全家 250`);
    if (text === '我的ID') return replyText(replyToken, `👤 ${memberName}\nID：${userId}`);
    if (text === '記帳清單') {
      const total = memoryRecords.reduce((sum, r) => sum + r.amount, 0);
      const recent = memoryRecords.slice(0, 10).map(r => `${r.date.slice(5,10)} ${r.who} ${r.amount}`).join('\n');
      return replyText(replyToken, `📊 共 ${total.toLocaleString()} 元\n${recent}`);
    }
    if (text === '🗑️ 清空紀錄') {
      await pool.query('DELETE FROM records');
      await loadAllRecords(); // 重新整理記憶體
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
        
        // 修正：這裡使用 userid (小寫)
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
    res.status(200).send('OK');
  }
});

cron.schedule('0 21 * * 5', async () => {
  const fetch = (await import('node-fetch')).default;
  await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ messages: [{ type: 'text', text: '記得記帳喔！' }] })
  }).catch(e => console.error(e));
}, { timezone: 'Asia/Taipei' });

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Port: ${port}`));
