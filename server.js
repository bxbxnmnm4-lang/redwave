
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ytdl = require('@distube/ytdl-core');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
let conversionInProgress = false;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// Serve local test audio files
app.use('/audio', express.static(
    UPLOAD_DIR,
    {
        acceptRanges: true,

        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.mp3')) {
                res.setHeader('Content-Type', 'audio/mpeg');
            }
        }
    }
));

function isValidYouTubeUrl(videoUrl) {
    try {
        const parsedUrl = new URL(videoUrl);

        const hostname = parsedUrl.hostname
            .toLowerCase()
            .replace(/^www\./, '');

        const allowedHosts = [
            'youtube.com',
            'm.youtube.com',
            'youtu.be'
        ];

        if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
            return false;
        }

        if (!allowedHosts.includes(hostname)) {
            return false;
        }

        if (hostname === 'youtu.be') {
            return parsedUrl.pathname.length > 1;
        }

        return (
            parsedUrl.pathname === '/watch' ||
            parsedUrl.pathname.startsWith('/shorts/') ||
            parsedUrl.pathname.startsWith('/embed/') ||
            parsedUrl.pathname.startsWith('/live/')
        );

    } catch {
        return false;
    }
}

function sanitizeFileName(name) {
    const base = String(name || 'audio')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

    return base || 'audio';
}

async function getVideoMetadata(videoUrl) {
    const info = await ytdl.getBasicInfo(videoUrl);

    return {
        title: info.videoDetails.title,
        author: info.videoDetails.ownerChannelName || 'YouTube',
        thumbnail: info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url || '',
    };
}

async function downloadYoutubeAudio(videoUrl) {
    if (conversionInProgress) {
        const error = new Error('A video is already being converted. Please wait a moment.');
        error.code = 'EBUSY';
        throw error;
    }

    conversionInProgress = true;

    try {
        if (!ffmpegPath) {
            throw new Error('ffmpeg is not available on this server.');
        }

        const info = await getVideoMetadata(videoUrl);
        const title = sanitizeFileName(info.title || 'youtube-audio');
        const fileName = `${Date.now()}-${title}.mp3`;
        const outputPath = path.join(UPLOAD_DIR, fileName);

        await new Promise((resolve, reject) => {
            const stream = ytdl(videoUrl, {
                quality: 'highestaudio',
                filter: 'audioonly',
                highWaterMark: 1 << 25,
            });

            const ffmpeg = spawn(ffmpegPath, [
                '-i', 'pipe:0',
                '-vn',
                '-ar', '44100',
                '-ac', '2',
                '-b:a', '192k',
                outputPath
            ]);

            let settled = false;

            const fail = (error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };

            stream.on('error', fail);
            ffmpeg.on('error', (error) => {
                if (error && error.code === 'EBUSY') {
                    fail(error);
                    return;
                }

                fail(error);
            });

            ffmpeg.on('close', (code) => {
                if (settled) return;

                if (code === 0) {
                    resolve();
                    return;
                }

                const conversionError = new Error(`ffmpeg exited with code ${code}`);
                conversionError.code = 'EBUSY';
                reject(conversionError);
            });

            stream.pipe(ffmpeg.stdin);
        });

        return {
            title: info.title,
            author: info.author,
            thumbnail: info.thumbnail,
            audioUrl: `/audio/${fileName}`,
            fileName
        };
    } finally {
        conversionInProgress = false;
    }
}

app.get('/api/video-info', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl) {
            return res.status(400).json({
                error: 'Please provide a video URL.'
            });
        }

        if (!isValidYouTubeUrl(videoUrl)) {
            return res.status(400).json({
                error: 'Invalid YouTube URL.'
            });
        }

        const apiUrl =
            `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

        const response = await fetch(apiUrl);

        if (!response.ok) {
            return res.status(400).json({
                error: 'Could not retrieve video information.'
            });
        }

        const data = await response.json();

        res.json({
            title: data.title,
            author: data.author_name,
            channel: data.author_name,
            thumbnail: data.thumbnail_url,
            provider: 'YouTube'
        });

    } catch (error) {
        console.error('Video information error:', error);

        res.status(500).json({
            error: 'Something went wrong while retrieving video information.'
        });
    }
});

app.get('/api/stream-audio', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl) {
            return res.status(400).json({
                error: 'Please provide a video URL.'
            });
        }

        if (!isValidYouTubeUrl(videoUrl)) {
            return res.status(400).json({
                error: 'Invalid YouTube URL.'
            });
        }

        const stream = ytdl(videoUrl, {
            quality: 'highestaudio',
            filter: 'audioonly',
            highWaterMark: 1 << 25,
        });

        const info = await getVideoMetadata(videoUrl);

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(info.title || 'youtube-audio')}.mp3"`);
        res.setHeader('Cache-Control', 'no-store');

        stream.on('error', (error) => {
            console.error('Audio stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Unable to stream audio from this video.'
                });
                return;
            }

            res.destroy(error);
        });

        stream.pipe(res);

    } catch (error) {
        console.error('Audio stream route error:', error);
        res.status(500).json({
            error: error.message || 'Unable to stream audio from this video.'
        });
    }
});

app.get('/api/download-audio', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl) {
            return res.status(400).json({
                error: 'Please provide a video URL.'
            });
        }

        if (!isValidYouTubeUrl(videoUrl)) {
            return res.status(400).json({
                error: 'Invalid YouTube URL.'
            });
        }

        const metadata = await getVideoMetadata(videoUrl);

        try {
            const audio = await downloadYoutubeAudio(videoUrl);
            return res.json(audio);
        } catch (error) {
            if (error && (error.code === 'EBUSY' || String(error.message).includes('EBUSY'))) {
                return res.json({
                    ...metadata,
                    audioUrl: `/api/stream-audio?url=${encodeURIComponent(videoUrl)}`,
                    fallback: true,
                    fileName: 'streamed-audio'
                });
            }

            throw error;
        }

    } catch (error) {
        console.error('Audio conversion error:', error);
        res.status(500).json({
            error: error.message || 'Could not convert this video into audio.'
        });
    }
});

app.listen(PORT, () => {
    console.log(`RedWave server running at http://localhost:${PORT}`);
});
