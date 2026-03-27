import { fs, path, axios, log } from "../globals.js";
import { statsManager } from "../utils/managers/statsManager.js";
import { registerReaction } from "../utils/reactionRegistry.js";
import * as cheerio from "cheerio";
import { ThreadType } from "zca-js";

/**
 * Module: autoxs
 * Bật/tắt tự động gửi kết quả xổ số vào nhóm lúc 18:32
 */

const DATA_FILE = path.join(process.cwd(), "src/modules/cache/auto_xo_so.json");

if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return []; }
}

function writeData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

function nowVN() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return { h: d.getHours(), m: d.getMinutes() };
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

// ─── Helper: parse bảng KQ nhiều tỉnh từ URL ────────────────────────────────
async function parseMultiProvince(url) {
  const res = await axios.get(url, {
    timeout: 30000,
    headers: { "User-Agent": UA, "Referer": url },
  });
  const $ = cheerio.load(res.data);

  // Thử các selector phổ biến của các trang xổ số
  const selectors = [
    "#load_kq_mn_0", "#load_kq_mt_0",
    ".box-kqxs-mn", ".box-kqxs-mt",
    "#box-kqxs", ".wrap-kqxs",
    "table.extendable",
  ];

  let tables = [];
  for (const sel of selectors) {
    const found = $(sel).find("table.extendable");
    if (found.length) { tables = found; break; }
  }
  // Fallback: tìm tất cả bảng kết quả
  if (!tables.length) tables = $("table.extendable");
  if (!tables.length) return [];

  const results = [];

  tables.each((_, table) => {
    const tbl = $(table);
    const nameEl = tbl.find("thead th, thead td, caption").first();
    const name = nameEl.text().replace(/kết quả xổ số/gi, "").trim() || `Tỉnh ${results.length + 1}`;

    const provinceResult = { name, results: [] };

    tbl.find("tbody tr").each((_, row) => {
      const tds = $(row).find("td");
      if (!tds.length) return;
      const giai = tds.eq(0).text().trim().toUpperCase().replace(/\s+/g, "").replace("GIẢI", "G").replace("ĐẶCBIỆT", "ĐB");
      if (!giai) return;
      const nums = [];
      tds.each((i, td) => {
        if (i === 0) return;
        const t = $(td).text().trim();
        if (t) nums.push(t);
      });
      if (nums.length) provinceResult.results.push({ giải: giai, kết_quả: nums });
    });

    if (provinceResult.results.length) results.push(provinceResult);
  });

  return results;
}

async function xsmn() {
  try {
    return await parseMultiProvince("https://xsmn.mobi/ket-qua-xo-so-mien-nam.html");
  } catch (e) {
    log.warn(`[autoxs] xsmn lần 1 lỗi: ${e.message}, thử URL dự phòng...`);
    return await parseMultiProvince("https://xsmn.mobi/");
  }
}

async function xsmt() {
  try {
    return await parseMultiProvince("https://xsmt.mobi/ket-qua-xo-so-mien-trung.html");
  } catch (e) {
    log.warn(`[autoxs] xsmt lần 1 lỗi: ${e.message}, thử URL dự phòng...`);
    return await parseMultiProvince("https://xsmt.mobi/");
  }
}

async function xsmb() {
  try {
    const res = await axios.get("https://xsmn.mobi/xsmb-xo-so-mien-bac.html", {
      timeout: 30000,
      headers: { "User-Agent": UA },
    });
    const $ = cheerio.load(res.data);

    const dateText = $('div.title-bor a[title^="XSMB ngày"]').attr("title");
    let date = dateText ? dateText.replace("XSMB ngày ", "").trim() : "Không rõ ngày";

    function luyNgay(ds) {
      const d = new Date(ds.split("-").reverse().join("-"));
      d.setDate(d.getDate() - 1);
      return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    }

    const data  = {};
    let results = [];

    $("table.kqmb tbody tr").each((_, el) => {
      const giai = $(el).find("td.txt-giai").text().trim();
      const num  = $(el).find("td.v-giai span").map((__, sp) => $(sp).text().trim()).get();
      if (giai && num.length) results.push({ giai, num });

      if (giai === "G.7") {
        data[date] = results.reduce((acc, { giai, num }) => {
          if (!acc[giai]) acc[giai] = [];
          acc[giai].push(...num);
          return acc;
        }, {});
        date    = luyNgay(date);
        results = [];
      }
    });

    if (results.length) {
      data[date] = results.reduce((acc, { giai, num }) => {
        if (!acc[giai]) acc[giai] = [];
        acc[giai].push(...num);
        return acc;
      }, {});
    }

    return { data };
  } catch (err) {
    log.error(`[autoxs] xsmb: ${err.message}`);
    return { data: {} };
  }
}

// ─── Format tin nhắn ─────────────────────────────────────────────────────────
function formatMBMsg(dateKey, fd) {
  const g = (...keys) => (keys.flatMap(k => fd[k] || []).join(", ")) || "—";
  return (
    `📋 Kết quả xổ số Miền Bắc ngày: ${dateKey}\n\n` +
    `🎯 Giải ĐB  : ${g("ĐB", "G.ĐB")}\n` +
    `1️⃣ Giải Nhất: ${g("G.1")}\n` +
    `2️⃣ Giải Nhì : ${g("G.2")}\n` +
    `3️⃣ Giải Ba  : ${g("G.3")}\n` +
    `4️⃣ Giải 4   : ${g("G.4")}\n` +
    `5️⃣ Giải 5   : ${g("G.5")}\n` +
    `6️⃣ Giải 6   : ${g("G.6")}\n` +
    `7️⃣ Giải 7   : ${g("G.7")}`
  );
}

const GIAI_LABELS = {
  "GĐB": "Giải Đặc Biệt", "ĐB": "Giải Đặc Biệt",
  "G1": "Giải Nhất",  "G2": "Giải Nhì",
  "G3": "Giải Ba",    "G4": "Giải 4",
  "G5": "Giải 5",     "G6": "Giải 6",
  "G7": "Giải 7",     "G8": "Giải 8",
};

function formatOneProvince(p, idx, total) {
  const header = total > 1 ? `📋 ${p.name} (${idx}/${total}):\n` : `📋 ${p.name}:\n`;
  const body = p.results.map(r => {
    const label = GIAI_LABELS[r.giải] || r.giải;
    return `${label}: ${r.kết_quả.join(" - ")}`;
  }).join("\n");
  const footer = total > 1 ? `\n\n💡 React ➡️ để xem tỉnh tiếp theo` : "";
  return header + body + footer;
}

function formatAllProvinces(provinces, region) {
  if (!provinces?.length) return `Không có dữ liệu xổ số ${region}.`;
  return provinces.map(p =>
    `📋 ${p.name}:\n` +
    p.results.map(r => `${GIAI_LABELS[r.giải] || r.giải}: ${r.kết_quả.join(" - ")}`).join("\n")
  ).join("\n\n─────────────────\n");
}

// ─── Gửi từng tỉnh với reaction pagination ───────────────────────────────────
async function sendProvincePaginated(api, provinces, region, idx, threadId, threadType) {
  if (!provinces?.length) {
    return api.sendMessage({ msg: `Không có dữ liệu xổ số ${region}.` }, threadId, threadType);
  }
  const p = provinces[idx];
  const msg = formatOneProvince(p, idx + 1, provinces.length);
  const sent = await api.sendMessage({ msg }, threadId, threadType);

  const nextIdx = idx + 1;
  if (nextIdx < provinces.length) {
    const msgId = sent?.data?.msgId || sent?.msgId || sent?.globalMsgId || sent?.data?.globalMsgId;
    if (msgId) {
      registerReaction(String(msgId), {
        ttl: 5 * 60 * 1000,
        senderId: null, // Ai cũng có thể react
        handler: async ({ api: rApi, threadId: rTid, threadType: rTt }) => {
          await sendProvincePaginated(rApi, provinces, region, nextIdx, rTid, rTt);
        },
      });
    }
  } else {
    await api.sendMessage({ msg: `✅ Đã xem hết ${provinces.length} tỉnh ${region}.` }, threadId, threadType);
  }
}

// ─── Ticker (khởi chạy từ bot.js) ───────────────────────────────────────────
export async function startXsTicker(api) {
  log.system("⏳ AutoXS Ticker đã sẵn sàng (gửi lúc 18:32)!");

  let lastFired = "";

  setInterval(async () => {
    const { h, m } = nowVN();
    if (h !== 18 || m !== 32) return;

    const key = `${h}:${m}`;
    if (lastFired === key) return;
    lastFired = key;

    try {
      const { data } = await xsmb();
      if (!data || !Object.keys(data).length) return;

      const toTs    = s => { const [d, mo, y] = s.split("-"); return new Date(y, mo - 1, d).getTime(); };
      const dateKey = Object.keys(data).sort((a, b) => toTs(b) - toTs(a))[0];
      if (!dateKey) return;

      const [mnResult, mtResult] = await Promise.allSettled([xsmn(), xsmt()]);

      const mbMsg = formatMBMsg(dateKey, data[dateKey]);

      const disabledIds = readData();
      const threads     = statsManager.getAllThreads();

      for (const id of threads) {
        if (disabledIds.includes(id)) continue;
        try {
          await api.sendMessage({ msg: mbMsg }, id, ThreadType.Group);
          await new Promise(r => setTimeout(r, 500));

          const mnProvinces = mnResult.status === "fulfilled" ? mnResult.value : null;
          if (mnProvinces?.length) {
            await api.sendMessage({ msg: `🌿 ─── KẾT QUẢ XỔ SỐ MIỀN NAM ───\n💡 React ➡️ từng tỉnh để xem lần lượt` }, id, ThreadType.Group);
            await sendProvincePaginated(api, mnProvinces, "Miền Nam", 0, id, ThreadType.Group);
          } else {
            const errMsg = mnResult.status === "rejected" ? `❌ Lỗi lấy XSMN: ${mnResult.reason?.message}` : "Không có dữ liệu XSMN.";
            await api.sendMessage({ msg: errMsg }, id, ThreadType.Group);
          }

          await new Promise(r => setTimeout(r, 500));

          const mtProvinces = mtResult.status === "fulfilled" ? mtResult.value : null;
          if (mtProvinces?.length) {
            await api.sendMessage({ msg: `🌸 ─── KẾT QUẢ XỔ SỐ MIỀN TRUNG ───\n💡 React ➡️ từng tỉnh để xem lần lượt` }, id, ThreadType.Group);
            await sendProvincePaginated(api, mtProvinces, "Miền Trung", 0, id, ThreadType.Group);
          } else {
            const errMsg = mtResult.status === "rejected" ? `❌ Lỗi lấy XSMT: ${mtResult.reason?.message}` : "Không có dữ liệu XSMT.";
            await api.sendMessage({ msg: errMsg }, id, ThreadType.Group);
          }
        } catch (e) {
          log.warn(`[autoxs] Gửi thất bại tới ${id}: ${e.message}`);
        }
      }
    } catch (err) {
      log.error(`[autoxs] ticker: ${err.message}`);
    }
  }, 1000);
}

// ─── Export ───────────────────────────────────────────────────────────────────
export const name        = "autoxs";
export const description = "Bật/tắt tự động gửi kết quả xổ số vào nhóm lúc 18:32. Lệnh: .xsmb .xsmn .xsmt";

export const commands = {
  autoxs: async (ctx) => {
    const { api, threadId, threadType } = ctx;
    const data  = readData();
    const isOff = data.includes(threadId);
    if (isOff) {
      writeData(data.filter(id => id !== threadId));
      return api.sendMessage({ msg: "✅ Đã bật tự động gửi kết quả xổ số cho nhóm này." }, threadId, threadType);
    } else {
      writeData([...data, threadId]);
      return api.sendMessage({ msg: "🔕 Đã tắt tự động gửi kết quả xổ số cho nhóm này." }, threadId, threadType);
    }
  },

  xsmb: async (ctx) => {
    const { api, threadId, threadType } = ctx;
    await api.sendMessage({ msg: "⏳ Đang lấy kết quả XSMB..." }, threadId, threadType);
    try {
      const { data } = await xsmb();
      if (!data || !Object.keys(data).length) return api.sendMessage({ msg: "❌ Không lấy được dữ liệu XSMB." }, threadId, threadType);
      const toTs    = s => { const [d, mo, y] = s.split("-"); return new Date(y, mo - 1, d).getTime(); };
      const dateKey = Object.keys(data).sort((a, b) => toTs(b) - toTs(a))[0];
      return api.sendMessage({ msg: formatMBMsg(dateKey, data[dateKey]) }, threadId, threadType);
    } catch (e) {
      return api.sendMessage({ msg: `❌ Lỗi lấy XSMB: ${e.message}` }, threadId, threadType);
    }
  },

  xsmn: async (ctx) => {
    const { api, threadId, threadType } = ctx;
    await api.sendMessage({ msg: "⏳ Đang lấy kết quả XSMN..." }, threadId, threadType);
    try {
      const provinces = await xsmn();
      if (!provinces?.length) return api.sendMessage({ msg: "❌ Không lấy được dữ liệu XSMN." }, threadId, threadType);
      await api.sendMessage({ msg: `🌿 KẾT QUẢ XỔ SỐ MIỀN NAM — ${provinces.length} tỉnh\n💡 React ➡️ để xem lần lượt từng tỉnh` }, threadId, threadType);
      await sendProvincePaginated(api, provinces, "Miền Nam", 0, threadId, threadType);
    } catch (e) {
      return api.sendMessage({ msg: `❌ Lỗi lấy XSMN: ${e.message}` }, threadId, threadType);
    }
  },

  xsmt: async (ctx) => {
    const { api, threadId, threadType } = ctx;
    await api.sendMessage({ msg: "⏳ Đang lấy kết quả XSMT..." }, threadId, threadType);
    try {
      const provinces = await xsmt();
      if (!provinces?.length) return api.sendMessage({ msg: "❌ Không lấy được dữ liệu XSMT." }, threadId, threadType);
      await api.sendMessage({ msg: `🌸 KẾT QUẢ XỔ SỐ MIỀN TRUNG — ${provinces.length} tỉnh\n💡 React ➡️ để xem lần lượt từng tỉnh` }, threadId, threadType);
      await sendProvincePaginated(api, provinces, "Miền Trung", 0, threadId, threadType);
    } catch (e) {
      return api.sendMessage({ msg: `❌ Lỗi lấy XSMT: ${e.message}` }, threadId, threadType);
    }
  },
};
