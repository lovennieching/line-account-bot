const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');  // 新增這行
const app = express();
app.use(express.json());

const LINE_TOKEN = '你的LINE_TOKEN';  // 移到 Environment Variables

// 用環境變數 [web:58]
const SHEET_ID = process.env.SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

let doc;

async function initSheets() {
  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    console.log('❌ 缺少 Google Sheets 環境變數，使用本地模式');
    return;
  }
  
  const serviceAccountAuth = new JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);  // 只這一行
  await doc.loadInfo();
  console.log('✅ Google Sheets 已連接');
}

// 啟動時初始化
initSheets().catch(console.error);
  
  doc = new GoogleSpreadsheet(SHEET_ID);
  
  // 使用服務帳戶認證 [web:1][web:2]
  await doc.useServiceAccountAuth({
    client_email: SERVICE_ACCOUNT_EMAIL,
    private_key: PRIVATE_KEY.replace(/\\n/g, '\n'),  // 處理 JSON 中的換行
  });
  
  await doc.loadInfo();
  console.log('Google Sheets 已連接');
}

// 啟動時初始化 Sheets
initSheets().catch(console.error);

function getMemberName(userId) {
  const FAMILY = {
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',    
  };
  return FAMILY[userId] || userId.slice(-8);
}

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
      // 從 Google Sheets 讀取最近記錄 [web:1]
      if (!doc) return replyAndEnd(replyToken, `${memberName}，Sheets 未準備好！`);
      
      const sheet = doc.sheetsByTitle[SHEET_NAME];
      const rows = await sheet.getRows({ limit: 10 });
      
      if (rows.length === 0) {
        return replyAndEnd(replyToken, `${memberName}，目前無記帳記錄！`);
      }
      
      const total = rows.reduce((sum, r) => sum + parseFloat(r.Amount || 0), 0);
      const recent = rows.map(r => `${r.Date?.slice(5,10) || ''} ${r.Who} ${r.Amount}`).join('\n');
      return replyAndEnd(replyToken, `📊 ${memberName}（共 ${total.toFixed(0)} 元）\n${recent}`);
    }

    if (text === '本月總計') {
      if (!doc) return replyAndEnd(replyToken, `${memberName}，Sheets 未準備好！`);
      
      const sheet = doc.sheetsByTitle[SHEET_NAME];
      const allRows = await sheet.getRows();
      const now = new Date();
      const nowMonth = now.getMonth() + 1;
      const nowYear = now.getFullYear();
      
      const monthRecords = allRows.filter(r => {
        if (!r.Date) return false;
        const match = r.Date.match(/(\d{4})\/(\d{1,2})/);
        return match && parseInt(match[2]) === nowMonth && parseInt(match[1]) === nowYear;
      });
      
      const monthTotal = monthRecords.reduce((sum, r) => sum + parseFloat(r.Amount || 0), 0);
      return replyAndEnd(replyToken, `📅 ${memberName}\n本月：${monthTotal.toFixed(0)} 元\n${monthRecords.length} 筆`);
    }

    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const category = parts[0];
      const amount = parseFloat(parts[parts.length - 1]);
      
      if (!isNaN(amount) && amount > 0) {
        const shop = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
        const recordDate = new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});
        
        // 寫入 Google Sheets [web:1][web:10]
        if (doc) {
          const sheet = doc.sheetsByTitle[SHEET_NAME];
          await sheet.addRow({
            Date: recordDate,
            Who: memberName,
            UserID: userId,
            Category: category,
            Shop: shop,
            Amount: amount
          });
        }
        
        return replyAndEnd(replyToken, `✅ ${memberName}：${category} ${shop || ''}${amount}元`);
      }
    }

    return replyAndEnd(replyToken, `${memberName}\n📝 餐飲 180\n📊 記帳清單\n📅 本月總計\n🆔 我的ID`);

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

app.get('/', async (req, res) => {
  try {
    const rowCount = doc ? (await doc.sheetsByTitle[SHEET_NAME]?.rowCount) || 0 : 0;
    res.send(`Bot 運行中\n記錄：${rowCount}`);
  } catch {
    res.send('Bot 運行中\nSheets 未連接');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bot @ ${port}`));
