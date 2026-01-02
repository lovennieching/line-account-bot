const express = require('express');
const app = express();

app.use(express.json());

// LINE Webhook
app.post('/webhook', (req, res) => {
  console.log('收到 LINE 訊息:', req.body);
  
  // 暫時只回 OK（之後加記帳邏輯）
  res.status(200).json({status: 'OK'});
});

// 狀態檢查
app.get('/', (req, res) => {
  res.send('家庭記帳 Bot Webhook 就緒');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`伺服器運行於 port ${port}`);
});
