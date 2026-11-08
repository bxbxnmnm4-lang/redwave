
const audioPlayer = document.getElementById('audioPlayer');
const playBtn = document.getElementById('playBtn');
const back15 = document.getElementById('back15');
const forward15 = document.getElementById('forward15');
const progressBar = document.getElementById('progressBar');
const currentTimeDisplay = document.getElementById('currentTime');
const durationDisplay = document.getElementById('duration');

const loadBtn = document.getElementById('convertBtn');
const urlInput = document.getElementById('youtubeUrl');
const trackTitle = document.getElementById('trackTitle');
const trackArtist = document.getElementById('trackArtist');
const status = document.getElementById('status');

const playbackSpeed = document.getElementById('playbackSpeed');
const muteBtn = document.getElementById('muteBtn');
const volumeBar = document.getElementById('volumeBar');

function setStatus(message) {
    if (status) status.textContent = message;
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

// Local test audio only
if (audioPlayer) {
    audioPlayer.src = '/audio/test.mp3';

    audioPlayer.addEventListener('loadedmetadata', () => {
        if (durationDisplay) {
            durationDisplay.textContent = formatTime(audioPlayer.duration);
        }
        setStatus('Audio file ready to play!');
    });

    audioPlayer.addEventListener('timeupdate', () => {
        if (!Number.isFinite(audioPlayer.duration)) return;

        if (progressBar) {
            progressBar.value =
                (audioPlayer.currentTime / audioPlayer.duration) * 100;
        }

        if (currentTimeDisplay) {
            currentTimeDisplay.textContent = formatTime(audioPlayer.currentTime);
        }
    });

    audioPlayer.addEventListener('ended', () => {
        if (playBtn) playBtn.textContent = '▶';
        if (progressBar) progressBar.value = 0;
    });

    audioPlayer.addEventListener('error', () => {
        setStatus('Audio loading failed. Check the file and server.');
    });

    audioPlayer.addEventListener('play', () => {
        if (playBtn) playBtn.textContent = 'Ⅱ';
    });

    audioPlayer.addEventListener('pause', () => {
        if (playBtn) playBtn.textContent = '▶';
    });
}

// Play / Pause
if (playBtn && audioPlayer) {
    playBtn.addEventListener('click', async () => {
        if (audioPlayer.paused) {
            try {
                await audioPlayer.play();
            } catch (error) {
                setStatus('Unable to play audio.');
            }
        } else {
            audioPlayer.pause();
        }
    });
}

// Skip controls
if (back15 && audioPlayer) {
    back15.addEventListener('click', () => {
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 15);
    });
}

if (forward15 && audioPlayer) {
    forward15.addEventListener('click', () => {
        if (Number.isFinite(audioPlayer.duration)) {
            audioPlayer.currentTime = Math.min(
                audioPlayer.duration,
                audioPlayer.currentTime + 15
            );
        }
    });
}

// Progress bar
if (progressBar && audioPlayer) {
    progressBar.addEventListener('input', () => {
        if (!Number.isFinite(audioPlayer.duration)) return;

        audioPlayer.currentTime =
            (progressBar.value / 100) * audioPlayer.duration;
    });
}

// Playback speed
if (playbackSpeed && audioPlayer) {
    playbackSpeed.addEventListener('change', () => {
        audioPlayer.playbackRate = Number(playbackSpeed.value);
    });
}

// Volume
if (volumeBar && muteBtn && audioPlayer) {
    volumeBar.addEventListener('input', () => {
        audioPlayer.volume = Number(volumeBar.value);
        audioPlayer.muted = false;

        muteBtn.textContent =
            audioPlayer.volume === 0 ? '🔇' : '🔊';
    });

    muteBtn.addEventListener('click', () => {
        audioPlayer.muted = !audioPlayer.muted;
        muteBtn.textContent = audioPlayer.muted ? '🔇' : '🔊';
    });
}

// YouTube video information
if (loadBtn && urlInput) {
    loadBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();

        if (!url) {
            setStatus('Please paste a YouTube link first.');
            return;
        }

        setStatus('Loading video information...');
        loadBtn.disabled = true;

        try {
            const response = await fetch(
                `/api/video-info?url=${encodeURIComponent(url)}`
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || 'Unable to load video information.'
                );
            }

            if (trackTitle) {
                trackTitle.textContent = data.title;
            }

            if (trackArtist) {
                trackArtist.textContent = data.author;
            }

            const cover = document.getElementById('videoThumbnail');

            if (cover && data.thumbnail) {
                cover.src = data.thumbnail;
                cover.style.display = 'block';
            }

            setStatus('Downloading and converting audio...');

            const audioResponse = await fetch(
                `/api/download-audio?url=${encodeURIComponent(url)}`
            );
            const audioData = await audioResponse.json();

            if (!audioResponse.ok) {
                throw new Error(
                    audioData.error || 'Unable to convert this video to audio.'
                );
            }

            if (audioPlayer) {
                audioPlayer.src = audioData.audioUrl;
                audioPlayer.load();
                await audioPlayer.play();
            }

            if (trackTitle) {
                trackTitle.textContent = audioData.title || data.title;
            }

            if (trackArtist) {
                trackArtist.textContent = audioData.author || data.author;
            }

            if (cover && audioData.thumbnail) {
                cover.src = audioData.thumbnail;
                cover.style.display = 'block';
            }

            setStatus('Audio ready and playing.');

        } catch (error) {
            console.error('RedWave error:', error);
            setStatus(error.message);

        } finally {
            loadBtn.disabled = false;
        }
    });

} else {
    console.error(
        'RedWave: Load button or YouTube URL input was not found.'
    );

    setStatus(
        'The link input or Load Audio button is missing. Check index.html.'
    );
}