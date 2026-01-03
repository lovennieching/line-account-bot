const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_TOKEN;  // Environment Variables

const SHEET_ID = process.env.SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

let doc;

async function initSheets() {
  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    console.log('❌ 缺少 Sheets 環境變數，列出缺少項目：', {
      SHEET_ID: !!SHEET_ID,
      SERVICE_ACCOUNT_EMAIL: !!SERVICE_ACCOUNT_EMAIL,
      PRIVATE_KEY: !!PRIVATE_KEY ? '有' : '無'
    });
    console.log('使用本地記錄模式');
    // 可加 let records = []; 作為 fallback
    return;
  }
  
  try {
    const fullPrivateKey = PRIVATE_KEY.replace(/\\n/g, '\n');
    const auth = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: fullPrivateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();
    console.log('✅ Google Sheets 已連接');
  } catch (error) {
    console.error('❌ Sheets 連線失敗：', error.message);
  }
}
  
  const auth = new JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  doc = new GoogleSpreadsheet(SHEET_ID, auth);
  await doc.loadInfo();
  console.log('✅ Google Sheets 已連接');
}

// 立即啟動（移到這裡）
initSheets().catch(console.error);

function getMemberName(userId) {
  const FAMILY = {
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',    
  };
  return FAMILY[userId] || userId.slice(-8);
}

// webhook, reply 等函式不變...

app.get('/', async (req, res) => {
  const rowCount = doc ? (await doc.sheetsByTitle['Sheet1']?.rowCount) || 0 : 0;
  res.send(`Bot 運行中\n記錄：${rowCount}`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bot @ ${port}`));
