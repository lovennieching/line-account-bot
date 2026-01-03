const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');
const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

let doc;
let memoryRecords = []; // 記憶體快取，提升查詢速度

// 初始化 Google Sheets
async function initSheet() {
  doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth({
    client_email: SERVICE_EMAIL,
    private_key: PRIVATE_KEY
  });
  await doc.loadInfo();
  console.log('✅ Google Sheets 已連線');
  await loadAllRecords(); // 載入現有資料到記憶體
}

async function loadAllRecords() {
  try {
    const sheet = doc.sheetsByTitle['記帳明細'];
    const rows = await sheet.getRows();
    memoryRecords = rows.map(row => ({
      who: row.get('成員'),
      userId: row.get('userId'),
      category: row.get('類別'),
      shop: row.get('店家'),
      amount: parseFloat(row.get('金額')),
      date: row.get('日期')
    }));
    console.log(`📊 載入 ${memoryRecords.length} 筆記錄`);
  } catch (e) {
    console.error('載入記錄錯誤：', e);
  }
}

// 寫入 Google Sheets
async function addRecord(memberName, userId, category, shop, amount) {
  try {
    const sheet = doc.sheetsByTitle['記帳明細'];
    await sheet.addRow({
      日期: new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'}),
      成員: memberName,
      類別: category,
      店家: shop || '',
      金額: amount,
      userId: userId
    });
    // 同步到記憶體
    const record = { who: memberName, userId, category, shop, amount, date: new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'}) };
    memoryRecords.push(record);
    if (memoryRecords.length > 1000) memoryRecords = memoryRecords.slice(-1000);
    console.log(`✅ 新增記錄：${memberName} ${amount}元`);
  } catch (e) {
    console.error('Sheets寫入錯誤：', e);
  }
}

function getMemberName(userId) {
  const FAMILY = {
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',    
  };
  return FAMILY[userId] || userId.slice(-8);
}

// Quick Reply 選單
async function showMenu(replyToken) {
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
            { type: 'action', action: { type: 'message', label: '🗑️ 清空紀錄', text: '清空紀錄' } }
          ]
        }
      }]
    })
  });
}

// 文字回覆
async function replyText(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  }).catch(e => console.error('回覆錯誤：', e));
}

// 星期五提醒
cron.schedule('0 21 * * 5', async () => {
  await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ messages: [{ type: 'text', text: '記得今晚MARK齊數，陣間要結算啦:)' }] })
  }).catch(e => console.error('提醒錯誤', e));
}, { timezone: 'Asia/Taipei' });

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    if (event.type !== 'message' || event.message.type !== 'text') return res.status(200).send('OK');

    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const userId = event.source.userId;
    const memberName = getMemberName(userId);

    if (['菜單', '選單', 'menu'].includes(text)) return showMenu(replyToken);
    if (text === '📝 記帳說明') return replyText(replyToken, `${memberName} 記帳教學：\n📝 餐飲 180\n📝 超市 全家 250\n記帳後自動回選單！`);
    if (text === '我的ID') return replyText(replyToken, `👤 ${memberName}\nID：\`${userId}\``);
    if (text === '清空紀錄') return replyText(replyToken, `🗑️ ${memberName} 已清空記憶體快取（Sheets保留）`);

    if (text === '記帳清單') {
      if (!memoryRecords.length) return replyText(replyToken, `${memberName}，目前無記帳記錄！`);
      const total = memoryRecords.reduce((sum, r) => sum + r.amount, 0);
      const recent = memoryRecords.slice(-10).map(r => `${r.date.slice(5,10)} ${r.who} ${r.amount}`).join('\n');
      return replyText(replyToken, `📊 ${memberName}（共 ${total} 元）\n${recent}`);
    }

    if (text === '本月總計') {
      const now = new Date();
      const monthRecords = memoryRecords.filter(r => {
        const match = r.date.match(/(\d{4})\/(\d{1,2})/);
        return match && parseInt(match[2]) - 1 === now.getMonth() && parseInt(match[1]) === now.getFullYear();
      });
      const monthTotal = monthRecords.reduce((sum, r) => sum + r.amount, 0);
      return replyText(replyToken, `📅 ${memberName}\n本月：${monthTotal} 元\n${monthRecords.length} 筆`);
    }

    if (text === '本週支出') {
      const now = new Date();
      const lastSaturday = new Date(now);
      lastSaturday.setDate(now.getDate() - (now.getDay() || 7) + 6);
      lastSaturday.setHours(0, 0, 0, 0);
      
      const userRecords = memoryRecords.filter(r => {
        const match = r.date.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!match) return false;
        const rDate = new Date(`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
        return rDate >= lastSaturday && r.userId === userId;
      });
      
      const weekTotal = userRecords.reduce((sum, r) => sum + r.amount, 0);
      return replyText(replyToken, `📈 ${memberName}\n本週（上週六至今）：${weekTotal} 元\n${userRecords.length} 筆`);
    }

    // 記帳
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const category = parts[0];
      const amount = parseFloat(parts[parts.length - 1]);
      if (!isNaN(amount) && amount > 0) {
        const shop = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
        await addRecord(memberName, userId, category, shop, amount);
        return replyText(replyToken, `✅ ${memberName}：${category} ${shop || ''}${amount}元`);
      }
    }

    return showMenu(replyToken);
  } catch (error) {
    console.error('Webhook錯誤：', error);
    res.status(200).send('ERROR');
  }
});

app.get('/', async (req, res) => {
  const summary = {
    totalRecords: memoryRecords.length,
    totalAmount: memoryRecords.reduce((sum, r) => sum + r.amount, 0),
    recent5: memoryRecords.slice(-5).map(r => `${r.date.slice(0,16)} ${r.who} ${r.category} ${r.shop ? `(${r.shop})` : ''} ${r.amount}元`)
  };
  res.send(`<h1>📊 記帳 Bot 狀態</h1><pre>${JSON.stringify(summary, null, 2)}</pre>
    <p><a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}">🗂️ 開 Google Sheets</a></p>`);
});

initSheet().catch(console.error);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bot @ ${port}`));
