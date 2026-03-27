import axios from "axios";

let cachedToken = null;
let tokenFetchedAt = 0;
const TOKEN_TTL = 60 * 1000; // Cache 60 giây

async function fetchPublicToken() {
    const now = Date.now();
    if (cachedToken && now - tokenFetchedAt < TOKEN_TTL) {
        return cachedToken;
    }
    try {
        const res = await axios.get('https://downloadvideo.vn/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; CPH2179) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.5'
            },
            timeout: 10000
        });
        const html = res.data;
        const match = html.match(/PUBLIC_API_TOKEN['":\s]+([A-Za-z0-9._\-]+)/);
        if (match && match[1]) {
            cachedToken = match[1];
            tokenFetchedAt = now;
            return cachedToken;
        }
    } catch (e) {
        // ignore
    }
    return null;
}

/**
 * Lấy link tải YouTube từ API vgasoft
 * @param {string} link - URL video YouTube
 * @returns {Promise<object>} - Dữ liệu video hoặc lỗi
 */
export async function downloadYoutube(link) {
    try {
        const token = await fetchPublicToken();

        const url = `https://download.vgasoft.vn/web/c/youtube/getVideo?link=${encodeURIComponent(link)}`;

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; CPH2179) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36',
            'Accept-Language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
            'OS': 'webSite',
            'Origin': 'https://downloadvideo.vn',
            'Referer': 'https://downloadvideo.vn/',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'sec-ch-ua': '"Chromium";v="107", "Not=A?Brand";v="24"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"'
        };

        if (token) {
            headers['PUBLIC_API_TOKEN'] = token;
        }

        const res = await axios.get(url, { headers, timeout: 30000 });
        return res.data;
    } catch (e) {
        return { error: true, message: e.message };
    }
}
