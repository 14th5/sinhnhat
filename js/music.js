import { APP as cfg } from './config.js';

const defaultMusicUrl = 'musics/tháng năm đẹp nhất cuộc đời.mp3';
        let bgMusicSrc = cfg.bgMusic || defaultMusicUrl;
        if (bgMusicSrc === 'assets/music/bgmucsic.mp3') bgMusicSrc = defaultMusicUrl;
        // Data URL (nhạc chọn từ máy) nhiều trình duyệt/Safari không phát ổn → đổi sang blob URL
        if (typeof bgMusicSrc === 'string' && bgMusicSrc.trim().startsWith('data:')) {
            try {
                const arr = bgMusicSrc.split(',');
                const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'audio/mpeg';
                const bstr = atob(arr[1] || '');
                const u8 = new Uint8Array(bstr.length);
                for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
                const blob = new Blob([u8], { type: mime });
                bgMusicSrc = URL.createObjectURL(blob);
            } catch (e) {
                console.warn('Không chuyển được nhạc data URL sang blob, dùng URL gốc:', e);
            }
        }
        const bgMusic = new Audio(bgMusicSrc);
        bgMusic.loop = true;
        bgMusic.volume = typeof cfg.bgVolume === 'number' ? cfg.bgVolume : 0.55;
        bgMusic.preload = 'auto';

        export function startBgMusic() {
            var vol = typeof cfg.bgVolume === 'number' ? cfg.bgVolume : 0.55;
            try {
                if (bgMusic.paused) {
                    bgMusic.currentTime = 0;
                }
                bgMusic.volume = 0;
                bgMusic.volume = vol;
                const p = bgMusic.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(function (err) {
                        console.warn('Không thể phát nhạc nền (thử nhạc mặc định):', err);
                        if (bgMusic.src !== defaultMusicUrl && !String(bgMusic.src || '').includes(defaultMusicUrl)) {
                            bgMusic.src = defaultMusicUrl;
                            bgMusic.load();
                            bgMusic.play().catch(function () {});
                        }
                    });
                }
            } catch (e) {
                console.warn('Không thể phát nhạc nền:', e);
            }
        }
        export function stopBgMusic() {
            try {
                bgMusic.pause();
                bgMusic.currentTime = 0;
            } catch (e) {
                console.warn('Không thể dừng nhạc nền:', e);
            }
        }
        // ════════════════════════════════════════════════════════════════
        