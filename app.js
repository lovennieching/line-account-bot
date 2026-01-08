const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const upload = multer({ dest: 'uploads/' }); // 設定暫存目錄

// --- 在 app.get('/') 的 HTML 中加入上傳表單 ---
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
    <h3>備份與匯入</h3>
    <p><a href="/records.csv">📥 下載目前 CSV 備份</a></p>
    <form action="/import-csv" method="post" enctype="multipart/form-data">
      <label>📤 匯入備份 CSV：</label>
      <input type="file" name="csvFile" accept=".csv" required>
      <button type="submit">開始匯入</button>
    </form>
    <p style="color: gray; font-size: 0.8em;">* 匯入格式必須與下載的 CSV 格式一致</p>
  `);
});

// --- 新增匯入 CSV 的 API ---
app.post('/import-csv', upload.single('csvFile'), async (req, res) => {
  if (!req.file) return res.status(400).send('未上傳檔案');

  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv(['日期', '成員', '類別', '店家', '金額', 'userId'])) // 對應你匯出的標題
    .on('data', (data) => {
      // 跳過標題列（如果 CSV 包含標題的話）
      if (data['日期'] === '日期') return;
      results.push(data);
    })
    .on('end', async () => {
      try {
        console.log(`開始匯入 ${results.length} 筆資料...`);
        
        for (const row of results) {
          // 將 CSV 格式轉回資料庫格式
          const amount = parseFloat(row['金額']);
          const isoDate = new Date(row['日期']).toISOString(); // 假設日期格式可辨識

          await pool.query(
            `INSERT INTO records (date, iso_date, who, userId, category, shop, amount) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [row['日期'], isoDate, row['成員'], row['userId'], row['類別'], row['店家'] || '', amount]
          );
        }

        // 刪除暫存檔並更新記憶體
        fs.unlinkSync(req.file.path);
        await loadAllRecords(); 
        
        res.send(`<h2>✅ 成功匯入 ${results.length} 筆紀錄！</h2><a href="/">回到首頁</a>`);
      } catch (err) {
        console.error('匯入失敗:', err);
        res.status(500).send('匯入過程中發生錯誤');
      }
    });
});
