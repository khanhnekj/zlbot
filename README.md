# 🤖 LauNa Bot

> Zalo Bot đa năng xây dựng trên [zca-js](https://github.com/RFS-ADRENO/zca-js) — lắng nghe tin nhắn real-time qua WebSocket.
> Project gốc bởi **DGK**, cập nhật & phát triển bởi **VLJNH**.

---

## ✨ Tính năng nổi bật

| Nhóm | Chức năng |
|------|-----------|
| 🎵 Âm nhạc | Tìm & tải nhạc từ Spotify, SoundCloud, NhacCuaTui, ZingMP3, YouTube |
| 🎬 Media | Tải video TikTok, CapCut, Instagram, Douyin, YouTube |
| 🎲 Giải trí | Tài xỉu, nối từ (noitu), ghép mặt, icon, thơ, fun |
| 👥 Quản lý nhóm | Kick, mute, duyệt thành viên, anti-unsend, auto-react, bảo vệ nhóm |
| 🔧 Tiện ích | Ping, thời tiết, lịch nhắc, tìm kiếm, gửi link, chạy code |
| 🤖 AI | Tích hợp Kaia AI |
| 💳 Thanh toán | ZaloPay, chia sẻ thẻ ngân hàng |
| 📊 Hệ thống | Thống kê bot, quản lý admin, prefix tùy chỉnh, thuê bot (rent) |

---

## 📋 Yêu cầu

- **Node.js** >= 18
- **FFmpeg** (để xử lý audio/video)
- Tài khoản **Zalo** dùng để chạy bot

---

## 🚀 Cài đặt

### Cách 1 — Ubuntu / VPS (x86_64)

```bash
# 1. Clone repo
git clone https://github.com/ljzinewbi06-arch/LauNa_Bot.git
cd LauNa_Bot

# 2. Cài dependencies
npm install

# 3. Cấu hình config.json (xem phần bên dưới)

# 4. Chạy bot
npm start
```

---

### Cách 2 — Termux + proot Ubuntu (Android/ARM64) 📱

> **Yêu cầu:** Termux cài sẵn, Node.js 20, Ubuntu qua proot-distro

```bash
# Bước 1: Cài proot-distro nếu chưa có
pkg install proot-distro
proot-distro install ubuntu
proot-distro login ubuntu

# Bước 2 (trong Ubuntu proot): Clone repo và chạy script tự động
git clone https://github.com/ljzinewbi06-arch/LauNa_Bot.git
cd LauNa_Bot
bash install.sh
```

Script `install.sh` sẽ tự động:
- Cài `ffmpeg`, `build-essential`, `libsqlite3-dev` và các thư viện cần thiết
- Kiểm tra / cài Node.js 20 nếu chưa có
- Chạy `npm install` (compile native modules từ source)
- Tạo `config.json` mẫu

**Sau khi cài:**
```bash
# Điền admin ID vào config.json
nano config.json

# Đăng nhập lần đầu (quét QR)
npm run login

# Chạy bot
npm start

# Chạy nền (Termux)
nohup npm start > bot.log 2>&1 &
```

> **Lưu ý ARM64:** Các package ảnh (`sharp`, `canvas`) và AI (`@tensorflow/tfjs-node`) sẽ được compile từ source. Nếu compile thất bại, bot vẫn chạy bình thường — các tính năng xử lý ảnh sẽ tự tắt. Cài `ffmpeg` qua apt để dùng đầy đủ tính năng audio/video.

---

## ⚙️ Cấu hình

Sao chép và chỉnh sửa file `config.json`:

```json
{
  "bot": {
    "prefix": ".",
    "selfListen": true,
    "autoAcceptInvites": false,
    "adminOnly": true
  },
  "credentials": {
    "imei": "",
    "userAgent": "",
    "cookies": ""
  },
  "admin": {
    "ids": ["ID_ZALO_CỦA_BẠN"]
  }
}
```

> **Lưu ý:** Để lấy `cookies` và `imei`, chạy lệnh `npm run login` và đăng nhập bằng QR code.

---

## 🔑 Đăng nhập

### Cách 1 — QR Code (lần đầu)
```bash
npm start
```
Quét QR hiện trên terminal bằng điện thoại Zalo. Thông tin đăng nhập sẽ tự lưu vào `config.json`.

### Cách 2 — Cookie có sẵn
Điền `imei`, `userAgent` và `cookies` vào `config.json`, bot sẽ tự đăng nhập.

---

## 📁 Cấu trúc project

```
LauNa_Bot/
├── bot.js              # Entry point chính
├── login.js            # Tiện ích đăng nhập
├── config.json         # Cấu hình bot (KHÔNG commit thông tin thật)
├── src/
│   ├── api-zalo/       # Wrapper Zalo API (zca-js)
│   ├── events/         # Xử lý các sự kiện (tin nhắn, reaction, ...)
│   ├── modules/        # Các lệnh / module của bot
│   └── utils/          # Thư viện tiện ích (db, downloader, music, ...)
└── package.json
```

---

## 📦 Các lệnh NPM

| Lệnh | Mô tả |
|------|-------|
| `npm start` | Chạy bot |
| `npm run dev` | Chạy bot với auto-reload khi thay đổi code |
| `npm run login` | Đăng nhập và lưu credentials |

---

## 🛠️ Thêm lệnh mới

Tạo file mới trong `src/modules/` theo cấu trúc:

```js
export const config = {
  name: "tenlenh",
  description: "Mô tả lệnh",
  usage: ".tenlenh [tham số]",
  admin: false,
};

export async function run({ api, message, args }) {
  await api.sendMessage("Xin chào!", message.data.threadId, message.type);
}
```

Xem thêm ví dụ tại `src/modules/template_command.js`.

---

## ⚠️ Lưu ý

- **Không** chia sẻ `config.json` chứa cookies/token thật.
- Bot dùng tài khoản Zalo thật — vi phạm Terms of Service của Zalo, dùng có chừng mực.
- Chỉ dùng cho mục đích học tập và cá nhân.

---

## 📄 License

ISC © DGK & VLJNH

---

# 📖 Hướng dẫn tạo Lệnh & Sự kiện

## Mục lục
1. [Cấu trúc thư mục](#1-cấu-trúc-thư-mục)
2. [Biến ctx – Tất cả thông tin bạn cần](#2-biến-ctx--tất-cả-thông-tin-bạn-cần)
3. [Tạo Module Lệnh (Command)](#3-tạo-module-lệnh-command)
4. [Tạo Sự kiện (Event)](#4-tạo-sự-kiện-event)
5. [Các API thường dùng](#5-các-api-thường-dùng)
6. [Gửi tin nhắn – Tất cả cách](#6-gửi-tin-nhắn--tất-cả-cách)
7. [Các Handler đặc biệt](#7-các-handler-đặc-biệt)
8. [Cooldown & Quyền hạn](#8-cooldown--quyền-hạn)
9. [Lưu / Đọc dữ liệu JSON](#9-lưu--đọc-dữ-liệu-json)
10. [Gửi file, ảnh, video](#10-gửi-file-ảnh-video)
11. [Checklist trước khi thêm module](#11-checklist-trước-khi-thêm-module)

---

## 1. Cấu trúc thư mục

```
src/
├── modules/         ← Lệnh bot (command) – mỗi file = 1 nhóm lệnh
│   ├── index.js     ← Tự động load tất cả file .js trong thư mục
│   ├── ping.js
│   ├── weather.js
│   └── template_command.js  ← FILE MẪU ĐẦY ĐỦ
├── events/          ← Sự kiện tự động (không cần prefix)
│   ├── index.js     ← Tự động load tất cả file .js trong thư mục
│   ├── hi.js
│   └── antiunsend.js
└── utils/
    └── listen.js    ← Xử lý luồng tin nhắn, gán ctx
```

> **Chỉ cần tạo file `.js` mới trong `src/modules/` hoặc `src/events/`**  
> Bot sẽ tự động load mà không cần sửa bất kỳ file nào khác.

---

## 2. Biến ctx – Tất cả thông tin bạn cần

Mọi lệnh và sự kiện đều nhận một object `ctx`. Đây là toàn bộ các thuộc tính:

| Thuộc tính | Kiểu | Mô tả |
|---|---|---|
| `ctx.api` | Object | API Zalo – dùng để gửi tin, lấy info,... |
| `ctx.threadId` | string | ID nhóm/người dùng đang nhắn |
| `ctx.threadType` | number | `1` = Nhóm, `0` = Chat riêng |
| `ctx.isGroup` | boolean | `true` nếu là nhóm |
| `ctx.senderId` | string | ID người gửi tin |
| `ctx.senderName` | string | Tên hiển thị người gửi |
| `ctx.isSelf` | boolean | `true` nếu chính bot gửi |
| `ctx.content` | string | Nội dung tin nhắn gốc |
| `ctx.args` | string[] | Các tham số sau lệnh (chỉ có trong command) |
| `ctx.prefix` | string | Ký tự prefix hiện tại (vd: `!`) |
| `ctx.adminIds` | string[] | Danh sách ID admin bot (owner) |
| `ctx.message` | Object | Dữ liệu message thô từ Zalo |
| `ctx.reply` | Function | Hàm reply siêu cấp (xem bên dưới) |
| `ctx.log` | Object | Logger: `ctx.log.info()`, `ctx.log.error()`,... |

---

## 3. Tạo Module Lệnh (Command)

### Cấu trúc tối thiểu

```js
// src/modules/ten_module.js

export const name = "ten_module";
export const description = "Mô tả module này làm gì";

export const commands = {
    tenlenh: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;
        await api.sendMessage({ msg: "Hello!" }, threadId, threadType);
    }
};
```

Người dùng gõ: `!tenlenh` → Bot phản hồi "Hello!"

---

### Một module nhiều lệnh

```js
export const commands = {
    lenh1: async (ctx) => { /* ... */ },
    lenh2: async (ctx) => { /* ... */ },
    alias: async (ctx) => { /* Gọi cùng hàm với lenh1 */ }
};
```

---

### Đọc tham số (args)

```js
tenlenh: async (ctx) => {
    const { args } = ctx;
    // Người dùng gõ: !tenlenh xin chào bạn
    // args = ["xin", "chào", "bạn"]

    const input = args.join(" "); // "xin chào bạn"
    const subCmd = args[0];       // "xin"
}
```

---

### Kiểm tra quyền admin

```js
tenlenh: async (ctx) => {
    const { api, threadId, threadType, senderId, adminIds } = ctx;

    if (!adminIds.includes(String(senderId))) {
        return api.sendMessage({ msg: "❌ Chỉ Admin mới dùng được lệnh này!" }, threadId, threadType);
    }

    // Code chỉ chạy nếu là admin
}
```

---

### Kiểm tra chỉ dùng trong nhóm

```js
tenlenh: async (ctx) => {
    const { api, threadId, threadType, isGroup } = ctx;

    if (!isGroup) {
        return api.sendMessage({ msg: "⚠️ Lệnh này chỉ dùng được trong nhóm!" }, threadId, threadType);
    }
}
```

---

## 4. Tạo Sự kiện (Event)

Sự kiện chạy trước lệnh. Nếu `handle()` trả về `true`, Bot sẽ không xử lý lệnh nữa.

### Cấu trúc tối thiểu

```js
// src/events/ten_event.js

export const name = "ten_event";
export const description = "Mô tả sự kiện này";

export async function handle(ctx) {
    const { content, api, threadId, threadType } = ctx;

    if (!content) return false;

    if (content.toLowerCase().includes("xin chào")) {
        await api.sendMessage({ msg: "Chào bạn! 👋" }, threadId, threadType);
        return true; // Đã xử lý → dừng lại, không chạy tiếp
    }

    return false; // Không xử lý → tiếp tục kiểm tra các event/lệnh khác
}
```

---

## 5. Các API thường dùng

```js
const { api, threadId, threadType } = ctx;

// Lấy thông tin nhóm
const groupInfo = await api.getGroupInfo(threadId);

// Lấy thông tin người dùng
const userInfo = await api.getUserInfo(senderId);

// Lấy danh sách thành viên nhóm
const members = await api.getGroupMembers(threadId);

// Kick thành viên
await api.removeUserFromGroup(userId, threadId);

// Đổi tên nhóm
await api.changeGroupName("Tên mới", threadId);

// Thêm reaction vào tin nhắn
await api.addReaction("ok", message);

// Hiệu ứng đang gõ
await api.sendTypingEvent(threadId, threadType);

// Lấy ID của chính bot
const botId = api.getOwnId();
```

---

## 6. Gửi tin nhắn – Tất cả cách

### Gửi văn bản đơn giản

```js
await api.sendMessage({ msg: "Nội dung tin nhắn" }, threadId, threadType);
```

---

### Gửi với @mention (tag tên người dùng)

```js
const name = ctx.senderName;
const msg = `Chào @${name}! Chúc bạn một ngày tốt lành.`;

await api.sendMessage({
    msg,
    mentions: [{
        uid: ctx.senderId,
        pos: msg.indexOf("@" + name), // Vị trí ký tự @ trong chuỗi
        len: name.length + 1           // Độ dài "@Tên"
    }]
}, threadId, threadType);
```

---

### Tag toàn bộ thành viên nhóm

```js
const msg = "[ 📣 THÔNG BÁO ]";
await api.sendMessage({
    msg,
    mentions: [{ uid: "-1", pos: 0, len: msg.length }]
}, threadId, threadType);
```

---

### Reply (trích dẫn) tin nhắn

```js
await api.sendMessage({
    msg: "Đây là tin nhắn reply",
    quote: ctx.message.data
}, threadId, threadType);
```

---

### Dùng ctx.reply() – Cách ngắn gọn hơn

```js
// Reply đơn giản
await ctx.reply("Nội dung reply");

// Reply với file đính kèm
await ctx.reply({ msg: "Đây là ảnh!", attachments: ["/path/to/file.jpg"] });

// Reply và tag người dùng (thay @tag trong chuỗi)
await ctx.reply("Chào @tag bạn ơi!", [ctx.senderId]);
```

---

### Gửi ảnh

```js
// Từ đường dẫn file local
await api.sendMessage({
    msg: "",
    attachments: ["/path/to/image.jpg"]
}, threadId, threadType);

// Từ URL (dùng sendImageEnhanced)
await api.sendImageEnhanced({
    imageUrl: "https://example.com/image.jpg",
    msg: "Caption ảnh",
    threadId,
    threadType,
    width: 720,
    height: 1280
});
```

---

### Gửi video

```js
await api.sendVideoEnhanced({
    videoUrl: "https://example.com/video.mp4",
    thumbnailUrl: "https://example.com/thumb.jpg",
    duration: 30,
    width: 720,
    height: 1280,
    msg: "Caption video",
    threadId,
    threadType
});
```

---

### Gửi file

```js
await api.sendMessage({
    msg: "",
    attachments: ["/path/to/file.pdf"]
}, threadId, threadType);
```

---

### Gửi sticker

```js
await api.sendSticker(
    { id: "STICKER_ID", cateId: "CATEGORY_ID", type: 1 },
    threadId,
    threadType
);
```

---

## 7. Các Handler đặc biệt

Ngoài `handle()`, một module có thể export thêm:

### handleReaction – Khi ai đó react vào tin nhắn

```js
export async function handleReaction(ctx) {
    const { api, threadId, threadType, senderId, senderName } = ctx;
    const { rIcon, msgId, cliMsgId } = ctx.message?.data || {};

    // rIcon: icon reaction (vd: "❤️", "😂",...)
    if (rIcon === "❤️") {
        await api.sendMessage({ msg: `${senderName} thả tim! 💖` }, threadId, threadType);
    }
}
```

---

### handleGroupEvent – Sự kiện nhóm (thêm/xóa thành viên,...)

```js
export async function handleGroupEvent(ctx) {
    const { api, threadId, threadType } = ctx;
    const { groupEventData } = ctx.message?.data || {};

    if (groupEventData?.updateMembers) {
        const members = groupEventData.updateMembers;
        const joined = members.filter(m => m.type === 1); // type=1: thêm mới
        const left = members.filter(m => m.type === 0);   // type=0: rời nhóm

        for (const m of joined) {
            await api.sendMessage({ msg: `Chào mừng ${m.dName} đã gia nhập nhóm! 🎉` }, threadId, threadType);
        }
    }
}
```

---

### handleUndo – Khi ai đó thu hồi tin nhắn

```js
export async function handleUndo(ctx) {
    const { api, threadId, threadType, senderId, senderName } = ctx;

    await api.sendMessage({
        msg: `⚠️ ${senderName} vừa thu hồi một tin nhắn!`
    }, threadId, threadType);
}
```

---

## 8. Cooldown & Quyền hạn

### Tự viết cooldown đơn giản

```js
const cooldownMap = new Map();
const COOLDOWN_MS = 60_000; // 60 giây

export const commands = {
    tenlenh: async (ctx) => {
        const { api, threadId, threadType, senderId } = ctx;
        const now = Date.now();
        const last = cooldownMap.get(senderId) || 0;

        if (now - last < COOLDOWN_MS) {
            const remaining = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
            return api.sendMessage({ msg: `⏳ Vui lòng chờ ${remaining}s!` }, threadId, threadType);
        }

        cooldownMap.set(senderId, now);
        // Code lệnh chính
    }
};
```

---

### Kiểm tra quyền admin nhóm (box admin)

```js
import { groupAdminManager } from "../utils/managers/groupAdminManager.js";

tenlenh: async (ctx) => {
    const { api, threadId, threadType, senderId } = ctx;
    const groupAdmins = await groupAdminManager.fetchGroupAdmins(api, threadId);

    if (!groupAdmins.includes(String(senderId))) {
        return api.sendMessage({ msg: "❌ Chỉ Admin nhóm mới dùng được!" }, threadId, threadType);
    }
}
```

---

## 9. Lưu / Đọc dữ liệu JSON

```js
import { fs, path } from "../globals.js";

const DATA_FILE = path.join(process.cwd(), "src/modules/cache/ten_module.json");

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) return {};
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    } catch {
        return {};
    }
}

function saveData(data) {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}
```

---

## 10. Gửi file, ảnh, video

### Download file từ URL rồi gửi

```js
import https from "node:https";
import http from "node:http";
import { fs, path } from "../globals.js";

function downloadFile(url, destPath) {
    return new Promise((resolve) => {
        const proto = url.startsWith("https") ? https : http;
        const file = fs.createWriteStream(destPath);
        proto.get(url, (res) => {
            res.pipe(file);
            file.on("finish", () => { file.close(); resolve(destPath); });
        }).on("error", () => { file.close(); resolve(null); });
    });
}

// Dùng:
const tmpPath = path.join(process.cwd(), `tmp_${Date.now()}.jpg`);
await downloadFile("https://example.com/image.jpg", tmpPath);
try {
    await api.sendMessage({ msg: "", attachments: [tmpPath] }, threadId, threadType);
} finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); // Xóa file tạm
}
```

---

## 11. Checklist trước khi thêm module

- [ ] File đặt đúng trong `src/modules/` (lệnh) hoặc `src/events/` (sự kiện)
- [ ] Export `name`, `description`
- [ ] Export `commands` (object) cho lệnh, hoặc `handle` (function) cho sự kiện
- [ ] Không trùng tên lệnh với module khác (bot sẽ cảnh báo trong log)
- [ ] Dọn file tạm (xóa ảnh/video đã gửi xong)
- [ ] Xử lý lỗi bằng try/catch, tránh crash bot
- [ ] Kiểm tra quyền trước khi chạy lệnh nhạy cảm

# Cài libjxl để decode ảnh JXL từ Zalo
pkg install libjxl

# Cài PM2 (nếu chưa có)
npm install -g pm2

# Chạy bot
npm run pm2:start

# Xem logs
npm run pm2:logs

# Tự khởi động khi reboot Termux
pm2 startup
pm2 save