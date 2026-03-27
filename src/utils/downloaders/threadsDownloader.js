import axios from "axios";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export async function fetchThreadsMedia(url) {
    const headers = {
        "accept": "*/*",
        "content-type": "application/x-www-form-urlencoded",
        "hx-request": "true",
        "hx-target": "result-container",
        "hx-trigger": "search-form",
        "origin": "https://savethr.com",
        "referer": "https://savethr.com/",
        "user-agent": UA,
    };

    const body = new URLSearchParams({ id: url, locale: "en" }).toString();
    const res = await axios.post("https://savethr.com/process", body, { headers, timeout: 20000 });
    const html = res.data;

    const images = [...html.matchAll(/href="(https:\/\/ssscdn\.io\/savethr\/[^"]+)"/g)].map(m => m[1]);
    const videos = [...html.matchAll(/href="(https:\/\/[^"]+\.mp4[^"]*)"/g)].map(m => m[1]);

    return [
        ...images.map(u => ({ type: "image", url: u })),
        ...videos.map(u => ({ type: "video", url: u })),
    ];
}

export async function downloadThreadsFile(item, index = 0) {
    const res = await axios.get(item.url, {
        responseType: "arraybuffer",
        headers: { "user-agent": UA },
        timeout: 30000,
    });

    const ct = res.headers["content-type"] || "";
    let ext = "jpg";
    if (ct.includes("video/"))       ext = "mp4";
    else if (ct.includes("image/png"))  ext = "png";
    else if (ct.includes("image/webp")) ext = "webp";

    const ts = Date.now();
    const rawPath = path.join(process.cwd(), `thr_raw_${ts}_${index}.${ext}`);
    fs.writeFileSync(rawPath, Buffer.from(res.data));

    if (ext === "webp") {
        const jpgPath = path.join(process.cwd(), `thr_${ts}_${index}.jpg`);
        try {
            execSync(`ffmpeg -y -i "${rawPath}" "${jpgPath}"`, { stdio: "pipe" });
            fs.unlinkSync(rawPath);
            return { filePath: jpgPath, ext: "jpg" };
        } catch {
            return { filePath: rawPath, ext: "webp" };
        }
    }

    return { filePath: rawPath, ext };
}
