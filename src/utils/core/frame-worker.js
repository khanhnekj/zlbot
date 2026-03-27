import { parentPort, workerData, isMainThread } from 'worker_threads';
import path from 'path';
import fs from 'fs';

// 🛡️ Guard Clause: Chỉ chạy nếu là Worker, không chạy khi bót khởi động bình thường
if (!isMainThread && workerData) {
    processFrames().catch(err => {
        console.error('Worker Error:', err);
        process.exit(1);
    });
}

async function processFrames() {
    const { startFrame, endFrame, size, totalFrames, framesDir, imageBuffer, circleMask } = workerData;

    let sharp;
    try {
        sharp = (await import('sharp')).default;
        sharp.cache(false);
    } catch (e) {
        parentPort.postMessage({ error: 'sharp not available: ' + e.message });
        return;
    }

    for (let i = startFrame; i < endFrame; i++) {
        const frameName = `frame_${String(i).padStart(3, '0')}.png`;
        const framePath = path.join(framesDir, frameName);

        // Bo tròn ảnh tĩnh bằng Sharp
        await sharp(imageBuffer)
            .resize(size, size)
            .composite([{
                input: circleMask,
                blend: 'dest-in'
            }])
            .png()
            .toFile(framePath);
    }

    parentPort.postMessage('done');
}
