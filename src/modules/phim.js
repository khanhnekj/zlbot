import { fs, path, axios, log } from "../globals.js";
import { drawMovieSearch, drawMovieDetail } from "../utils/canvas/canvasHelper.js";
import ffmpeg from "fluent-ffmpeg";
import { execSync } from "node:child_process";

try { ffmpeg.setFfmpegPath(execSync("which ffmpeg", { encoding: "utf8" }).trim()); } catch {}
try { ffmpeg.setFfprobePath(execSync("which ffprobe", { encoding: "utf8" }).trim()); } catch {}

export const name = "phim";
export const description = "Tìm kiếm và xem phim từ PhimAPI";

const PHIMAPI = "https://phimapi.com";

const pendingPhimSearch = new Map();
const pendingPhimEpisodes = new Map();

const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
    "Referer": `${PHIMAPI}/`,
    "Origin": PHIMAPI,
};

let _sessionCookie = "";

async function getSessionCookie() {
    try {
        const res = await axios.get(`${PHIMAPI}/danh-sach/phim-moi-cap-nhat?page=1`, {
            headers: BROWSER_HEADERS,
            timeout: 8000,
        });
        const setCookie = res.headers["set-cookie"];
        if (setCookie) {
            _sessionCookie = setCookie.map(c => c.split(";")[0]).join("; ");
        }
    } catch {}
}

async function apiGet(url, retries = 2) {
    const headers = { ...BROWSER_HEADERS };
    if (_sessionCookie) headers["Cookie"] = _sessionCookie;

    for (let i = 0; i <= retries; i++) {
        try {
            const res = await axios.get(url, { headers, timeout: 10000 });
            if (res.data?.status === false && res.data?.msg === "hmmm!") {
                await getSessionCookie();
                headers["Cookie"] = _sessionCookie;
                continue;
            }
            return res.data;
        } catch (e) {
            if (i === retries) throw e;
            await new Promise(r => setTimeout(r, 800 * (i + 1)));
        }
    }
}

async function getLatest(page = 1) {
    return await apiGet(`${PHIMAPI}/danh-sach/phim-moi-cap-nhat?page=${page}`);
}

async function getDetail(slug) {
    return await apiGet(`${PHIMAPI}/phim/${slug}`);
}

async function searchPhim(keyword) {
    if (!_sessionCookie) await getSessionCookie();
    const data = await apiGet(`${PHIMAPI}/tim-kiem?keyword=${encodeURIComponent(keyword)}`);
    if (data?.status === false || !data?.items?.length) {
        throw new Error("API tìm kiếm không khả dụng, dùng lệnh không có từ khoá để duyệt phim mới");
    }
    return data;
}

function buildCdnReferers(m3u8Url) {
    const referers = [
        "https://phimapi.com/",
        "https://player.phimapi.com/",
        "https://ophim1.com/",
        "https://kkphim.vip/",
        "https://www.phimmoi.net/",
        "https://vip.opstream17.com/",
        "https://player.ophim.dev/",
    ];
    try {
        const u = new URL(m3u8Url);
        const cdnOrigin = `${u.protocol}//${u.host}/`;
        if (!referers.includes(cdnOrigin)) referers.unshift(cdnOrigin);
    } catch {}
    return referers;
}

async function downloadM3U8(m3u8Url, outputPath) {
    const referers = buildCdnReferers(m3u8Url);
    let lastErr = null;

    for (const referer of referers) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Timeout 90s")), 90000);
                const proc = ffmpeg(m3u8Url)
                    .inputOptions([
                        "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
                        "-user_agent", BROWSER_HEADERS["User-Agent"],
                        "-headers",
                        `Referer: ${referer}\r\nOrigin: ${new URL(referer).origin}\r\nAccept: */*\r\nAccept-Language: vi-VN,vi;q=0.9\r\n`,
                    ])
                    .outputOptions(["-c copy", "-bsf:a aac_adtstoasc", "-movflags +faststart"])
                    .output(outputPath)
                    .on("end", () => { clearTimeout(timer); resolve(); })
                    .on("error", (err) => { clearTimeout(timer); reject(err); });
                proc.run();
            });
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10240) return;
            throw new Error("File quá nhỏ sau khi tải");
        } catch (err) {
            lastErr = err;
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        }
    }
    throw lastErr || new Error("Không tải được M3U8 từ bất kỳ CDN nào");
}

function buildWatchLink(ep) {
    const m3u8 = ep.link_m3u8;
    const embed = ep.link_embed;
    if (embed) return embed;
    if (m3u8) return `https://player.phimapi.com/player/?url=${encodeURIComponent(m3u8)}`;
    return null;
}

async function sendMsg(ctx, text) {
    await ctx.api.sendMessage({ msg: text, quote: ctx.message?.data }, ctx.threadId, ctx.threadType);
}

export const commands = {
    phim: async (ctx) => {
        const { api, threadId, threadType, senderId, args } = ctx;
        const query = args.join(" ").trim();

        const pageMatch = query.match(/^(?:trang\s*|t|p)(\d+)$/i);
        const isPageOnly = !query || pageMatch || /^\d+$/.test(query);
        const page = pageMatch ? parseInt(pageMatch[1]) : (/^\d+$/.test(query) ? parseInt(query) : 1);

        if (!query || isPageOnly) {
            const pageNum = Math.max(1, page);
            await sendMsg(ctx, `📡 Đang tải phim mới trang ${pageNum}...`);
            const data = await getLatest(pageNum);
            const items = data?.items || data?.data?.items || [];
            if (!items.length) return sendMsg(ctx, `❌ Không còn phim ở trang ${pageNum}.`);

            const buffer = await drawMovieSearch(items.slice(0, 5), `PHIM MỚI — TRANG ${pageNum}`);
            const tmpPath = path.join(process.cwd(), `src/modules/cache/phim_search_${Date.now()}.png`);
            fs.writeFileSync(tmpPath, buffer);

            pendingPhimSearch.set(`${threadId}-${senderId}`, items.slice(0, 5));
            await api.sendMessage({
                msg: `🎬 Phim mới trang ${pageNum} — phản hồi số (1-5) để xem chi tiết.\n💡 Xem trang khác: .phim trang 2`,
                attachments: [tmpPath]
            }, threadId, threadType);
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            setTimeout(() => pendingPhimSearch.delete(`${threadId}-${senderId}`), 120000);
            return;
        }

        try {
            await sendMsg(ctx, `🔍 Đang tìm kiếm: "${query}"...`);
            const data = await searchPhim(query);
            const items = data?.items || data?.data?.items || [];

            if (!items.length) return sendMsg(ctx, `❌ Không tìm thấy phim nào với từ khoá: "${query}"`);

            const results = items.slice(0, 5);
            const buffer = await drawMovieSearch(results, query);
            const tmpPath = path.join(process.cwd(), `src/modules/cache/phim_search_${Date.now()}.png`);
            fs.writeFileSync(tmpPath, buffer);

            pendingPhimSearch.set(`${threadId}-${senderId}`, results);
            await api.sendMessage({
                msg: `🎬 Tìm thấy ${items.length} kết quả — phản hồi số (1-5) để xem chi tiết.`,
                attachments: [tmpPath]
            }, threadId, threadType);
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            setTimeout(() => pendingPhimSearch.delete(`${threadId}-${senderId}`), 120000);
        } catch (e) {
            log.error("[Phim] Search error:", e.message);
            await sendMsg(ctx, `❌ ${e.message}`);
        }
    }
};

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType } = ctx;
    const trimmed = content?.trim();
    const num = parseInt(trimmed);

    const searchKey = `${threadId}-${senderId}`;
    const episodeKey = `${threadId}-${senderId}-ep`;

    if (!isNaN(num) && num >= 1) {
        if (pendingPhimEpisodes.has(episodeKey)) {
            const epData = pendingPhimEpisodes.get(episodeKey);
            const episodes = epData.episodes;
            const idx = num - 1;

            if (idx >= episodes.length) {
                await api.sendMessage({ msg: `❌ Không có tập ${num}. Chọn từ 1-${episodes.length}.` }, threadId, threadType);
                return true;
            }

            if (epData._timeout) clearTimeout(epData._timeout);
            epData._timeout = setTimeout(() => pendingPhimEpisodes.delete(episodeKey), 15 * 60 * 1000);

            const ep = episodes[idx];
            const epName = ep.name || `Tập ${num}`;
            const movieName = epData.movieName || "Phim";
            const watchLink = buildWatchLink(ep);

            const allM3u8s = [ep.link_m3u8, ...(ep._fallbackM3u8 || [])].filter(u => u?.startsWith("http"));

            if (allM3u8s.length > 0) {
                await api.sendMessage({
                    msg: `⏳ Đang tải "${epName}" — "${movieName}"... Chờ tí nha!`
                }, threadId, threadType);

                const tmpMp4 = path.join(process.cwd(), `phim_ep_${Date.now()}.mp4`);
                let downloaded = false;

                for (const streamUrl of allM3u8s) {
                    try {
                        await downloadM3U8(streamUrl, tmpMp4);
                        if (fs.existsSync(tmpMp4) && fs.statSync(tmpMp4).size > 10240) {
                            downloaded = true;
                            break;
                        }
                    } catch (err) {
                        log.warn(`[Phim] Stream thất bại (${new URL(streamUrl).host}): ${err.message}`);
                    }
                }

                try {
                    if (downloaded) {
                        const stat = fs.statSync(tmpMp4);
                        const sizeMB = (stat.size / 1024 / 1024).toFixed(1);

                        if (stat.size > 200 * 1024 * 1024) {
                            await api.sendMessage({
                                msg: `[ 🎬 ${movieName} ]\n📺 ${epName} — File quá lớn (${sizeMB} MB)\n\n🔗 Xem online:\n${watchLink}`
                            }, threadId, threadType);
                        } else {
                            await api.sendVideoUnified({
                                videoPath: tmpMp4,
                                msg: `🎬 ${movieName} — ${epName}`,
                                threadId,
                                threadType
                            });
                            await api.sendMessage({
                                msg: `📺 Tập ${num}/${episodes.length} | Gõ số tập khác (1-${episodes.length}) để đổi!`
                            }, threadId, threadType);
                        }
                    } else {
                        await api.sendMessage({
                            msg: `[ 🎬 ${movieName} ]\n📺 Tập: ${epName}\n⚠️ CDN chặn tải trực tiếp.\n\n🔗 Xem online tại:\n${watchLink || "Không có link"}\n\n💡 Gõ số tập khác (1-${episodes.length}) để thử tập khác!`
                        }, threadId, threadType);
                    }
                } finally {
                    if (fs.existsSync(tmpMp4)) fs.unlinkSync(tmpMp4);
                }
            } else {
                await api.sendMessage({
                    msg: `[ 🎬 ${movieName} ]\n📺 Tập: ${epName}\n\n🔗 Xem online:\n${watchLink || "Không có link."}\n\n💡 Gõ số tập khác (1-${episodes.length}) để đổi tập!`
                }, threadId, threadType);
            }
            return true;
        }

        if (pendingPhimSearch.has(searchKey)) {
            if (num > 5) return false;
            const movies = pendingPhimSearch.get(searchKey);
            const movie = movies[num - 1];
            if (!movie) return false;

            pendingPhimSearch.delete(searchKey);
            await api.sendMessage({ msg: `📡 Đang tải chi tiết "${movie.name || movie.slug}"...` }, threadId, threadType);

            try {
                const detail = await getDetail(movie.slug);
                const movieInfo = detail?.movie || detail?.data?.item || {};
                const rawEpisodes = detail?.episodes || detail?.data?.episodes || [];

                let episodeList = [];
                const allServers = rawEpisodes.filter(s => s.server_data?.length > 0);
                if (allServers.length > 0) {
                    episodeList = allServers[0].server_data.map((ep, i) => {
                        const fallbackLinks = allServers.slice(1)
                            .map(s => s.server_data?.[i]?.link_m3u8)
                            .filter(Boolean);
                        return { ...ep, _fallbackM3u8: fallbackLinks };
                    });
                }

                if (!episodeList.length) {
                    return await api.sendMessage({ msg: `❌ Phim này chưa có tập nào hoặc đang cập nhật.` }, threadId, threadType);
                }

                const buffer = await drawMovieDetail(movieInfo, episodeList);
                const tmpPath = path.join(process.cwd(), `src/modules/cache/phim_detail_${Date.now()}.png`);
                fs.writeFileSync(tmpPath, buffer);

                const epEntry = {
                    episodes: episodeList,
                    movieName: movieInfo.name || movie.name,
                    _timeout: null
                };
                epEntry._timeout = setTimeout(() => pendingPhimEpisodes.delete(episodeKey), 15 * 60 * 1000);
                pendingPhimEpisodes.set(episodeKey, epEntry);

                const epNames = episodeList.slice(0, 20).map((e, i) => `${i + 1}.${e.name || `Tập ${i + 1}`}`).join("  ");
                await api.sendMessage({
                    msg: `🎬 ${movieInfo.name || movie.name}\n📺 ${episodeList.length} tập\n─────────────────\n${epNames}${episodeList.length > 20 ? `\n...và ${episodeList.length - 20} tập nữa` : ""}\n─────────────────\n💡 Gõ số tập để tải và xem!`,
                    attachments: [tmpPath]
                }, threadId, threadType);
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            } catch (e) {
                log.error("[Phim] Detail error:", e.message);
                await api.sendMessage({ msg: `❌ Lỗi lấy chi tiết phim: ${e.message}` }, threadId, threadType);
            }
            return true;
        }
    }

    return false;
}

getSessionCookie().catch(() => {});
