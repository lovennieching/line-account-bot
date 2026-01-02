const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const app = express();

app.use(express.json());

// Google Sheet 設定（之後改你的）
const SHEET_ID = '你的試算表ID';  // 試算表網址 ?gid=xxx 裡的 ID
const SHEET_NAME = '明細';
const SERVICE_ACCOUNT_EMAIL = '';  // 之後設定
const PRIVATE_KEY = '';            // 之後設定

// LINE Webhook
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events[0];
    
    // 只處理文字訊息
    if (event.type !== 'message' || event.message.type !== 'text') {
      return res.status(200).json({status: 'OK'});
    }

    const text = event.message.text.trim();
    const replyToken = event.replyToken;

    // 解析「類別 店家 金額」
    const parts = text.replace(/\s+/g, ' ').split(' ');
    if (parts.length < 3) {
      await reply(replyToken, '格式：類別 店家 金額\n例：餐飲 麥當勞 180');
      return res.status(200).json({status: 'OK'});
    }

    const category = parts[0];
    const shop = parts[1];
    const amount = parseFloat(parts[2]);

    if (isNaN(amount) || amount <= 0) {
      await reply(replyToken, '金額必須是大於 0 的數字');
      return res.status(200).json({status: 'OK'});
    }

    // 寫入 Google Sheet（暫時 console.log）
    console.log(`記帳：${category} ${shop} ${amount}`);
    
    await reply(replyToken, `✅ 已記帳：${category} / ${shop} / ${amount}元`);
    res.status(200).json({status: 'OK'});
  } catch (error) {
    console.error('錯誤：', error);
    res.status(200).json({status: 'ERROR'});
  }
});

// 回覆 LINE
async function reply(replyToken, message) {
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'rs1z63zui+VBM34QAuCJMZ5uNv3BcwaGcgc4f0KzApm/F6q1GZd+UtSNnNbSR3QMZhZl0j/+evGxqXrVLf22xahmRhaauuZaaSwr1UTwNluQwFIstmM/dM4W9E/td5+E9APtWkRPc2KlQ9gy0+rTKQdB04t89/1O/w1cDnyilFU='  // 改成真的
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: message }]
    })
  });
}

// 狀態檢查
app.get('/', (req, res) => {
  res.send('家庭記帳 Bot Webhook 就緒');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`伺服器運行於 port ${port}`);
});
