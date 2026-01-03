const express = require('express');
const fetch = require('node-fetch');
const cron = require('node-cron');

const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_TOKEN || '請改成你的TOKEN';
const REMIND_TARGET_ID = process.env.REMIND_TARGET_ID || '請填群組或某人ID';

let records = [];

/* 家庭成員對照 */
function getMemberName(userId) {
  const FAMILY = {
    'U7b036b0665085f9f4089970b04e742b6': '葉大屁',
    'Ucfb49f6b2aa41068f59aaa4a0b3d01dd': '列小芬',
  };
  return FAMILY[userId] || userId.slice(-8);
}

/* ================== 每週五 21:00 提醒 ================== */
cron.schedule('0 21 * * 5', async () => {
  const text = '⏰ 提醒：記得今晚 MARK 齊數，陣間要結算啦 :)';
  await pushMessage(REMIND_TARGET_ID, text);
}, {
  timezone: 'Asia/Taipei'
});

/* ================== webhook ================== */
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events?.[0];
    if (!event || event.type !== 'message' || event.message.type !== 'text') {
      return res.status(200).send('OK');
    }

    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const userId = event.source.userId;
    const memberName = getMemberName(userId);

    /* 我的ID */
    if (text === '我的ID') {
      return replyAndEnd(replyToken, `👤 ${memberName}\nID：\`${userId}\``);
    }

    /* 清空紀錄 */
    if (text === '清空紀錄') {
      records = [];
      return replyAndEnd(replyToken, `🗑️ ${memberName}，所有記帳紀錄已清空`);
    }

    /* 記帳清單 */
    if (text === '記帳清單') {
      if (records.length === 0) {
        return replyAndEnd(replyToken, `${memberName}，目前無記帳記錄！`);
      }
      const total = records.reduce((sum, r) => sum + r.amount, 0);
      const recent = records
        .slice(-10)
        .map(r => `${r.date.slice(5, 10)} ${r.who} ${r.amount}`)
        .join('\n');

      return replyAndEnd(
        replyToken,
        `📊 ${memberName}（共 ${total} 元）\n${recent}`
      );
    }

    /* 本月總計 */
    if (text === '本月總計') {
      const now = new Date();
      const month = now.getMonth();
      const year = now.getFullYear();

      const monthRecords = records.filter(r => {
        const d = new Date(r.date.replace(/\//g, '-'));
        return d.getMonth() === month && d.getFullYear() === year;
      });

      const total = monthRecords.reduce((sum, r) => sum + r.amount, 0);
      return replyAndEnd(
        replyToken,
        `📅 ${memberName}\n本月：${total} 元\n${monthRecords.length} 筆`
      );
    }

    /* 本週支出（上週六 00:00 起） */
    if (text === '本週支出') {
      const now = new Date();
      const taipeiNow = new Date(
        now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })
      );

      const day = taipeiNow.getDay(); // 0(日)~6(六)
      const diff = (day + 1) % 7;

      const lastSaturday = new Date(taipeiNow);
      lastSaturday.setDate(taipeiNow.getDate() - diff);
      lastSaturday.setHours(0, 0, 0, 0);

      const weekRecords = records.filter(r => {
        const d = new Date(r.date.replace(/\//g, '-'));
        return d >= lastSaturday;
      });

      const total = weekRecords.reduce((sum, r) => sum + r.amount, 0);

      return replyAndEnd(
        replyToken,
        `📆 ${memberName}\n本週支出：${total} 元\n${weekRecords.length} 筆`
      );
    }

    /* 記帳格式：分類 [店家] 金額 */
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const category = parts[0];
      const amount = parseFloat(parts[parts.length - 1]);

      if (!isNaN(amount) && amount > 0) {
        const shop = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';

        const record = {
          who: memberName,
          userId,
          category,
          shop,
          amount,
          date: new Date().toLocaleString('zh-TW', {
            timeZone: 'Asia/Taipei'
          })
        };

        records.push(record);
        if (records.length > 100) records = records.slice(-100);

        return replyAndEnd(
          replyToken,
          `✅ ${memberName}：${category} ${shop || ''}${amount} 元`
        );
      }
    }

    /* 指令提示 */
    return replyAndEnd(
      replyToken,
`${memberName}
📝 餐飲 180
📊 記帳清單
📅 本月總計
📆 本週支出
🗑️ 清空紀錄
🆔 我的ID`
    );

  } catch (err) {
    console.error(err);
    return res.status(200).send('ERROR');
  }
});

/* ================== LINE API ================== */
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

async function pushMessage(to, text) {
  if (!to) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_TOKEN}`
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text }]
      })
    });
  } catch (e) {
    console.error('推送錯誤：', e);
  }
}

/* ================== server ================== */
app.get('/', (req, res) =>
  res.send(`Bot 運行中\n記錄數：${records.length}`)
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bot running on ${port}`));
