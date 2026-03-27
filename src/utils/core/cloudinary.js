import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";
import { log } from "../../logger.js";

function getCloudinaryCfg() {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "tokens.json"), "utf-8"));
        return cfg.cloudinary || {};
    } catch { return {}; }
}

async function cloudinaryUpload(filePath) {
    const { cloud = "dhbw0ivzj", preset = "bot_upload", apiKey } = getCloudinaryCfg();
    const url = `https://api.cloudinary.com/v1_1/${cloud}/auto/upload`;
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("upload_preset", preset);
    if (apiKey) form.append("api_key", apiKey);
    const res = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 120000,
        maxBodyLength: Infinity
    });
    return res.data?.secure_url || null;
}

/**
 * Upload file từ URL lên Cloudinary
 */
export async function uploadFromUrl(url, headers = {}) {
    const ext = (url.split("?")[0].split(".").pop() || "mp4").slice(0, 5);
    const tempPath = path.join(process.cwd(), `cld_tmp_${Date.now()}.${ext}`);
    try {
        const response = await axios({
            method: "GET",
            url,
            responseType: "stream",
            timeout: 60000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
                ...headers
            }
        });
        const writer = fs.createWriteStream(tempPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });
        const secureUrl = await cloudinaryUpload(tempPath);
        return secureUrl;
    } catch (e) {
        log.error("Lỗi uploadFromUrl (Cloudinary):", e.message);
        throw e;
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
}

/**
 * Upload file từ máy lên Cloudinary
 */
export async function uploadFromFile(filePath) {
    try {
        const secureUrl = await cloudinaryUpload(filePath);
        return secureUrl;
    } catch (e) {
        log.error("Lỗi uploadFromFile (Cloudinary):", e.message);
        throw e;
    }
}
