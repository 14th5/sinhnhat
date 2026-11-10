
        import * as THREE from 'three';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
        import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
        import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
        import { createNoise3D, createNoise4D } from 'simplex-noise';
import { APP } from './config.js';
import { startBgMusic, stopBgMusic } from './music.js';

        (async () => {

        // Đọc config + feature flags (chờ nếu đang load từ API)
        const cfg = APP;

        // Feature flags — hiệu ứng hạt bật mặc định, các mục khác tắt (opt-in)
        const enablePasscode    = cfg.enablePasscode === true;
        const enableMorphEffect = cfg.enableMorphEffect !== false;
        const enableSphere      = cfg.enableSphere === true;
        const enableSphereFlyingImages = cfg.enableSphereFlyingImages === true;
        const enableLetter      = cfg.enableLetter === true;
        const enableWebsiteInfo = cfg.enableWebsiteInfo === true;

        let scene, camera, renderer, controls, clock;
        let composer, bloomPass; 

        let particlesGeometry, particlesMaterial, particleSystem;
        let backgroundParticleSystem = null, backgroundParticlesGeometry = null, backgroundParticlesMaterial = null;
        let backgroundSourcePositions = null;
        let currentPositions, sourcePositions, targetPositions; 
        let particleSizes, particleOpacities, particleEffectStrengths; 
        let noise3D, noise4D; 

        let isInitialized = false;

        const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
        const CONFIG = {
            particleCount: 25000,
            imageParticleCount: 400000,
            textParticleCountMin: 6000,
            textParticleCountMax: 120000,
            textParticlesPerChar: 3500,
            shapeSize: 14,
            textShapeSize: isDesktop ? 22 : 14,
            swarmDistanceFactor: 1.5,
            swirlFactor: 4.0,
            noiseFrequency: 0.1,
            noiseTimeScale: 0.04,
            noiseMaxStrength: 2.8,
            morphDuration: 2.0,
            particleSizeRange: [0.06, 0.18],
            imageParticleSizeRange: [0.038, 0.052],
            bloomStrength: 0.9,
            bloomRadius: 0.5,
            bloomThreshold: 0.15,
            idleFlowStrength: 0.25,
            idleFlowSpeed: 0.08,
            idleRotationSpeed: 0.02,
            morphSizeFactor: 0.5, 
            morphBrightnessFactor: 0.6 
        };

        const tempVec = new THREE.Vector3();
        const sourceVec = new THREE.Vector3();
        const flowVec = new THREE.Vector3();
        const currentVec = new THREE.Vector3();

        /** Lấy vị trí + màu từ ảnh: độ phân giải cao, màu chính xác, chi tiết nét hơn. */
        function generateFromImage(img, count, size) {
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            const maxDim = 2600;
            if (w > maxDim || h > maxDim) {
                const s = maxDim / Math.max(w, h);
                w = Math.round(w * s);
                h = Math.round(h * s);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;
            const list = [];
            const brightnessThreshold = 1;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
                    const brightness = (r + g + b) / 3;
                    if (a > 10 && brightness > brightnessThreshold) {
                        list.push({ x, y, brightness, r, g, b, key: y * w + x });
                    }
                }
            }
            if (list.length === 0) return null;
            list.sort((a, b) => a.key - b.key);
            const actualCount = Math.min(count, list.length);
            const scale = size / Math.max(w, h);
            const cx = w / 2, cy = h / 2;
            const depthScale = size * 0.06;
            const points = new Float32Array(actualCount * 3);
            const colors = new Float32Array(actualCount * 3);
            for (let i = 0; i < actualCount; i++) {
                const idx = list.length <= actualCount ? i : Math.floor((i * list.length) / actualCount);
                const p = list[Math.min(idx, list.length - 1)];
                const px = (p.x - cx) * scale;
                const py = (cy - p.y) * scale;
                const pz = (p.brightness / 255) * depthScale;
                points[i * 3] = px;
                points[i * 3 + 1] = py;
                points[i * 3 + 2] = pz;
                let r = p.r / 255, g = p.g / 255, b = p.b / 255;
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                r = gray + (r - gray) * 1.12;
                g = gray + (g - gray) * 1.12;
                b = gray + (b - gray) * 1.12;
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                if (lum > 0.5) {
                    const t = (lum - 0.5) / 0.5;
                    const darken = 1 - t * 0.4;
                    r *= darken; g *= darken; b *= darken;
                } else if (lum < 0.2) {
                    const lift = 1.25;
                    r = Math.min(1, r * lift); g = Math.min(1, g * lift); b = Math.min(1, b * lift);
                }
                colors[i * 3] = Math.max(0, Math.min(1, r));
                colors[i * 3 + 1] = Math.max(0, Math.min(1, g));
                colors[i * 3 + 2] = Math.max(0, Math.min(1, b));
            }
            return { positions: points, colors };
        }

        /** Tạo vị trí hạt từ chữ. Vẽ chữ lên canvas rồi lấy mẫu pixel. Có giới hạn chiều ngang, dài thì xuống dòng. */
        function generateFromText(text, count, size) {
            if (!text || !text.trim()) return null;
            const w = 800;
            const maxLineWidth = 680;
            const fontSize = 140;
            const lineHeight = 170;
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = `bold ${fontSize}px "Pacifico", cursive`;
            const words = text.trim().split(/\s+/);
            const lines = [];
            let line = '';
            for (const word of words) {
                const next = line ? line + ' ' + word : word;
                if (ctx.measureText(next).width <= maxLineWidth) {
                    line = next;
                } else {
                    if (line) lines.push(line);
                    line = ctx.measureText(word).width <= maxLineWidth ? word : word;
                }
            }
            if (line) lines.push(line);
            const h = Math.max(280, lines.length * lineHeight + 60);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx2 = canvas.getContext('2d');
            ctx2.fillStyle = '#000';
            ctx2.fillRect(0, 0, w, h);
            ctx2.fillStyle = '#fff';
            ctx2.font = `bold ${fontSize}px "Pacifico", cursive`;
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'middle';
            const startY = h / 2 - (lines.length - 1) * (lineHeight / 2);
            lines.forEach((ln, i) => {
                ctx2.fillText(ln, w / 2, startY + i * lineHeight);
            });
            const data = ctx2.getImageData(0, 0, w, h).data;
            const list = [];
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                    if (brightness > 20) list.push({ x, y, brightness, key: y * w + x });
                }
            }
            if (list.length === 0) return null;
            list.sort((a, b) => a.key - b.key);
            const scale = size / Math.max(w, h);
            const cx = w / 2, cy = h / 2;
            const depthScale = size * 0.05;
            const points = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const maxRadius = size * 0.6;
            for (let i = 0; i < count; i++) {
                const idx = Math.min(Math.floor((i * list.length) / count), list.length - 1);
                const p = list[idx];
                const px = (p.x - cx) * scale;
                const py = (cy - p.y) * scale;
                const pz = (p.brightness / 255) * depthScale;
                points[i * 3] = px;
                points[i * 3 + 1] = py;
                points[i * 3 + 2] = pz;
                const dist = Math.sqrt(px * px + py * py + pz * pz);
                const hue = THREE.MathUtils.mapLinear(dist, 0, maxRadius, 330, 360);
                const c = new THREE.Color().setHSL(hue / 360, 0.82, 0.45);
                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;
            }
            return { positions: points, colors };
        }

        let particleCount = 0;
        let isMorphing = false;
        let morphStartTime = 0;

        function rebuildParticleSystemForImage(result) {
            const count = result.positions.length / 3;
            particleCount = count;
            if (particleSystem) {
                scene.remove(particleSystem);
                particlesGeometry.dispose();
                particlesMaterial.dispose();
            }

            currentPositions = new Float32Array(result.positions);
            sourcePositions = new Float32Array(result.positions);
            targetPositions = [new Float32Array(result.positions)];

            particlesGeometry = new THREE.BufferGeometry();
            particlesGeometry.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));

            const [minS, maxS] = CONFIG.imageParticleSizeRange;
            particleSizes = new Float32Array(count);
            particleOpacities = new Float32Array(count);
            particleEffectStrengths = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                particleSizes[i] = THREE.MathUtils.randFloat(minS, maxS);
                particleOpacities[i] = 1.0;
                particleEffectStrengths[i] = 0.0;
            }
            particlesGeometry.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));
            particlesGeometry.setAttribute('opacity', new THREE.BufferAttribute(particleOpacities, 1));
            particlesGeometry.setAttribute('aEffectStrength', new THREE.BufferAttribute(particleEffectStrengths, 1));
            particlesGeometry.setAttribute('color', new THREE.BufferAttribute(result.colors, 3));

            particlesMaterial = new THREE.ShaderMaterial({
                 uniforms: { pointTexture: { value: createSharpParticleTexture() } },
                 vertexShader: `
                      attribute float size; attribute float opacity; attribute float aEffectStrength;
                      varying vec3 vColor; varying float vOpacity; varying float vEffectStrength;
                      void main() {
                           vColor = color; vOpacity = opacity; vEffectStrength = aEffectStrength;
                           vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                           float sizeScale = 1.0 - vEffectStrength * 0.5;
                           gl_PointSize = size * sizeScale * (650.0 / -mvPosition.z);
                           gl_Position = projectionMatrix * mvPosition;
                      }`,
                 fragmentShader: `
                      uniform sampler2D pointTexture;
                      varying vec3 vColor; varying float vOpacity; varying float vEffectStrength;
                      void main() {
                           float alpha = texture2D(pointTexture, gl_PointCoord).a;
                           if (alpha < 0.05) discard;
                           gl_FragColor = vec4(vColor, alpha * vOpacity);
                      }`,
                 blending: THREE.NormalBlending, depthTest: true, depthWrite: false, transparent: true, vertexColors: true
            });

            particleSystem = new THREE.Points(particlesGeometry, particlesMaterial);
            scene.add(particleSystem);
        }

        function startMorphToResult(result) {
            const count = result.positions.length / 3;
            const positions = particlesGeometry.attributes.position.array;
            sourcePositions = new Float32Array(positions);
            targetPositions = [new Float32Array(result.positions)];
            particlesGeometry.attributes.color.array.set(result.colors);
            particlesGeometry.attributes.color.needsUpdate = true;
            isMorphing = true;
            morphStartTime = clock.getElapsedTime();
        }

        function applyImageToParticles(result) {
            if (!scene || !result) return;
            const { colors: imageColors } = result;
            if (!imageColors) return;
            bloomPass.strength = 0.22;
            bloomPass.threshold = 0.35;
            const count = result.positions.length / 3;
            if (particleSystem && particleCount === count) {
                startMorphToResult(result);
                return;
            }
            rebuildParticleSystemForImage(result);
        }

        async function applyTextToParticles(text) {
            if (!scene) return;
            await document.fonts.load('140px "Pacifico"');
            const chars = text.trim().length;
            const textParticleCount = Math.min(CONFIG.textParticleCountMax,
                Math.max(CONFIG.textParticleCountMin, chars * CONFIG.textParticlesPerChar));
            const result = generateFromText(text, textParticleCount, CONFIG.shapeSize);
            if (!result) return;
            bloomPass.strength = 0.28;
            bloomPass.threshold = 0.42;
            const count = result.positions.length / 3;
            if (particleSystem && particleCount === count) {
                startMorphToResult(result);
                return;
            }
            rebuildParticleSystemForImage(result);
        }

        function init() {
            let progress = 0;
            const progressBar = document.getElementById('progress');
            const loadingScreen = document.getElementById('loading');
            function updateProgress(increment) {
                progress += increment;
                progressBar.style.width = `${Math.min(100, progress)}%`;
                if (progress >= 100) {
                    setTimeout(() => {
                        loadingScreen.style.opacity = '0';
                        setTimeout(() => { loadingScreen.style.display = 'none'; }, 600);
                    }, 200);
                }
            }

            clock = new THREE.Clock();
            noise3D = createNoise3D(() => Math.random());
            noise4D = createNoise4D(() => Math.random());
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x000000);
            scene.fog = new THREE.FogExp2(0x000000, 0.03);
            updateProgress(5);

            camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
            if (isDesktop) {
                camera.position.set(0, 6, 18);
            } else {
                camera.position.set(0, 8, 26);
            } 
            camera.lookAt(scene.position);
            updateProgress(5);

            const canvas = document.getElementById('webglCanvas');
            renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            updateProgress(10);

            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true; controls.dampingFactor = 0.05;
            controls.minDistance = 5; controls.maxDistance = 80;
            controls.autoRotate = false;
            updateProgress(5);

            scene.add(new THREE.AmbientLight(0x554050));
            const dirLight1 = new THREE.DirectionalLight(0xfff0f5, 1.4);
            dirLight1.position.set(15, 20, 10); scene.add(dirLight1);
            const dirLight2 = new THREE.DirectionalLight(0xffb6c1, 0.9);
            dirLight2.position.set(-15, -10, -15); scene.add(dirLight2);
            updateProgress(10);

            setupPostProcessing(); updateProgress(10);
            updateProgress(25);

            window.addEventListener('resize', onWindowResize);
            updateProgress(40);

            isInitialized = true;
            animate();

            // Rẽ nhánh theo feature flags
            if (enableMorphEffect) {
                prepareAndWait();           // morph hạt → sphere (nếu enableSphere) → letter (nếu enableLetter)
            } else if (enableSphere) {
                startSpherePhase();         // bỏ morph, vào thẳng sphere
            } else if (enableLetter) {
                // Chỉ có lá thư: cho phong thư bay lên ngay
                startCupidLetterSequence();
            }
            // nếu cả ba đều tắt: chỉ render scene tối giản (không có gì xảy ra)
        }

        function setupPostProcessing() {
            composer = new EffectComposer(renderer);
            composer.addPass(new RenderPass(scene, camera));
            bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), CONFIG.bloomStrength, CONFIG.bloomRadius, CONFIG.bloomThreshold);
            composer.addPass(bloomPass);
        }

        function createSharpParticleTexture() {
            const size = 128; const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size; const context = canvas.getContext('2d');
            const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            gradient.addColorStop(0, 'rgba(255,255,255,1)');
            gradient.addColorStop(0.4, 'rgba(255,255,255,0.98)');
            gradient.addColorStop(0.7, 'rgba(255,255,255,0.6)');
            gradient.addColorStop(0.92, 'rgba(255,255,255,0.15)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            context.fillStyle = gradient; context.fillRect(0, 0, size, size);
            return new THREE.CanvasTexture(canvas);
        }

        // ── AutoPlay sequence ──────────────────────────────────────────────
        const AUTOPLAY_TEXT_COUNT = 80000;
        const BACKGROUND_SCATTER_COUNT = 5000;
        const SEQUENCE_HOLD_MS = 1000;
        const MORPH_WAIT_MS = 2200;
        /** Thời gian ảnh overlay fade từ mờ → rõ (ms). */
        const MORPH_OVERLAY_FADE_MS = 1200;
        /** Thời gian giữ ảnh hiển thị trước khi nổ (ms). */
        const MORPH_OVERLAY_HOLD_MS = 3800;

        let _preloadedImg = null;
        /** Mesh ảnh đè lên sau khi 80k hạt tạo xong (thay cho phase 280k). */
        let morphImageOverlay = null;
        /** Thời điểm bắt đầu fade-in overlay (để animate() tăng opacity dần). */
        let morphOverlayFadeStartTime = null;

        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        /**
         * Tạo plane ảnh trong scene 3D trên layer riêng (layer 1).
         * Bloom chỉ chạy layer 0 (hạt), sau đó renderer vẽ thêm layer 1 không qua bloom
         * → ảnh hiển thị đúng màu, không lóa, đúng vị trí với hạt.
         */
        function createMorphImageOverlay(img) {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            const size = CONFIG.textShapeSize;
            const aspect = w / h;
            const planeW = aspect >= 1 ? size : size * aspect;
            const planeH = aspect >= 1 ? size / aspect : size;

            // Dùng canvas để render ảnh đủ kích thước, tránh mất nét do texture upload
            const srcW = img.naturalWidth  || img.width;
            const srcH = img.naturalHeight || img.height;
            const offscreen = document.createElement('canvas');
            offscreen.width  = srcW;
            offscreen.height = srcH;
            const octx = offscreen.getContext('2d');
            octx.imageSmoothingEnabled = true;
            octx.imageSmoothingQuality = 'high';
            octx.drawImage(img, 0, 0, srcW, srcH);

            const geometry = new THREE.PlaneGeometry(planeW, planeH, 1, 1);
            const texture  = new THREE.CanvasTexture(offscreen);
            texture.generateMipmaps = false;          // tắt mipmap → không bị mờ do level blend
            texture.minFilter       = THREE.LinearFilter;
            texture.magFilter       = THREE.LinearFilter;
            texture.anisotropy      = renderer.capabilities.getMaxAnisotropy();
            texture.colorSpace      = THREE.SRGBColorSpace; // giữ màu chính xác
            texture.needsUpdate     = true;
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: 0,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(0, 0, 0);
            mesh.lookAt(camera.position);  // xoay mặt phẳng về phía camera → không bị méo perspective
            mesh.renderOrder = 10;
            // layer 1 → bloom pass không thấy, renderer thứ hai mới vẽ
            mesh.layers.set(1);
            scene.add(mesh);
            return mesh;
        }

        function removeMorphImageOverlay() {
            morphOverlayFadeStartTime = null;
            if (!morphImageOverlay) return;
            scene.remove(morphImageOverlay);
            if (morphImageOverlay.geometry) morphImageOverlay.geometry.dispose();
            if (morphImageOverlay.material) {
                if (morphImageOverlay.material.map) morphImageOverlay.material.map.dispose();
                morphImageOverlay.material.dispose();
            }
            morphImageOverlay = null;
        }

        /** Tạo 5000 hạt nền rải đều (thêm riêng, không lấy từ 80k). */
        function createBackgroundScatterLayer() {
            const count = BACKGROUND_SCATTER_COUNT;
            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const [minS, maxS] = CONFIG.imageParticleSizeRange;
            const sizes = new Float32Array(count);
            const opacities = new Float32Array(count);
            const effectStrengths = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const r = 3 + Math.random() * 14;
                positions[i3]     = r * Math.sin(phi) * Math.cos(theta);
                positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                positions[i3 + 2] = r * Math.cos(phi);
                const hue = 330 + Math.random() * 30;
                const c = new THREE.Color().setHSL(hue / 360, 0.8, 0.4 + Math.random() * 0.2);
                colors[i3] = c.r; colors[i3 + 1] = c.g; colors[i3 + 2] = c.b;
                sizes[i] = THREE.MathUtils.randFloat(minS * 0.8, maxS * 0.8);
                opacities[i] = 0.85;
                effectStrengths[i] = 0;
            }
            backgroundSourcePositions = new Float32Array(positions);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
            geo.setAttribute('aEffectStrength', new THREE.BufferAttribute(effectStrengths, 1));
            const mat = new THREE.ShaderMaterial({
                uniforms: { pointTexture: { value: createSharpParticleTexture() } },
                vertexShader: `
                    attribute float size; attribute float opacity; attribute float aEffectStrength;
                    varying vec3 vColor; varying float vOpacity; varying float vEffectStrength;
                    void main() {
                        vColor = color; vOpacity = opacity; vEffectStrength = aEffectStrength;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        float sizeScale = 1.0 - vEffectStrength * 0.5;
                        gl_PointSize = size * sizeScale * (650.0 / -mvPosition.z);
                        gl_Position = projectionMatrix * mvPosition;
                    }`,
                fragmentShader: `
                    uniform sampler2D pointTexture;
                    varying vec3 vColor; varying float vOpacity; varying float vEffectStrength;
                    void main() {
                        float alpha = texture2D(pointTexture, gl_PointCoord).a;
                        if (alpha < 0.05) discard;
                        gl_FragColor = vec4(vColor, alpha * vOpacity);
                    }`,
                blending: THREE.NormalBlending, depthTest: true, depthWrite: false, transparent: true, vertexColors: true
            });
            backgroundParticlesGeometry = geo;
            backgroundParticlesMaterial = mat;
            backgroundParticleSystem = new THREE.Points(geo, mat);
            backgroundParticleSystem.renderOrder = -1;
            scene.add(backgroundParticleSystem);
        }

        /** Tạo hạt rải ngẫu nhiên trong không gian (80k). + 5k nền riêng. */
        function initScatterParticles() {
            const count = AUTOPLAY_TEXT_COUNT;
            const positions = new Float32Array(count * 3);
            const colors    = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                const theta = Math.random() * Math.PI * 2;
                const phi   = Math.acos(2 * Math.random() - 1);
                const r     = 3 + Math.random() * 14;
                positions[i3]     = r * Math.sin(phi) * Math.cos(theta);
                positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                positions[i3 + 2] = r * Math.cos(phi);
                const hue = 330 + Math.random() * 30;
                const c = new THREE.Color().setHSL(hue / 360, 0.8, 0.45 + Math.random() * 0.2);
                colors[i3] = c.r; colors[i3 + 1] = c.g; colors[i3 + 2] = c.b;
            }
            createBackgroundScatterLayer();
            bloomPass.strength = 0.5;
            bloomPass.threshold = 0.1;
            rebuildParticleSystemForImage({ positions, colors });
        }

        function showText(text) {
            const result = generateFromText(text, AUTOPLAY_TEXT_COUNT, CONFIG.textShapeSize);
            if (!result) return;
            bloomPass.strength = 0.28;
            bloomPass.threshold = 0.42;
            const count = result.positions.length / 3;
            if (particleSystem && particleCount === count) {
                startMorphToResult(result);
            } else {
                rebuildParticleSystemForImage(result);
            }
        }

        /** Tải trước font + ảnh, tạo scatter, rồi hiện nút giữ */
        async function prepareAndWait() {
            await document.fonts.load('140px "Pacifico"');
            const imgSrc = (cfg.particleImage && String(cfg.particleImage).trim()) ? cfg.particleImage : null;
            if (imgSrc) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = imgSrc;
                await new Promise(r => { img.onload = r; img.onerror = r; });
                _preloadedImg = img.naturalWidth ? img : null; // ảnh lỗi/không tồn tại → bỏ qua
            } else {
                _preloadedImg = null;
            }

            initScatterParticles();
            isScatterPhase = true;

            // setup nút giữ — Android: chạm 2 lần (lần 2 phát nhạc + chạy); iOS: ấn giữ 1s
            const wrap    = document.getElementById('start-wrap');
            const ringFill = document.getElementById('ring-fill');
            const startLabel = document.getElementById('start-label');
            wrap.style.display = 'flex';

            var isAndroid = /Android/i.test(navigator.userAgent || '');
            var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            var holdTimer = null;
            var holdStartTime = 0;
            var HOLD_MS = 1000;
            var triggered = false;
            var androidTapCount = 0;
  
            if (startLabel) startLabel.textContent = isAndroid ? 'Chạm 2 lần để bắt đầu' : 'Giữ để bắt đầu';

            function onDown(e) {
                e.preventDefault();
                if (triggered) return;
                if (isAndroid) {
                    androidTapCount++;
                    if (androidTapCount === 1) {
                        if (startLabel) startLabel.textContent = 'Chạm 2 lần để bắt đầu';
                        return;
                    }
                    if (typeof startBgMusic === 'function') {
                        try { startBgMusic(); } catch (_) {}
                    }
                    triggered = true;
                    wrap.style.display = 'none';
                    startAutoPlay();
                    return;
                }
                holdStartTime = Date.now();
                if (typeof startBgMusic === 'function') {
                    try { startBgMusic(); } catch (_) {}
                }
                ringFill.style.transition = 'stroke-dashoffset 1s linear';
                ringFill.style.strokeDashoffset = '163.36';
                void ringFill.offsetHeight;
                ringFill.style.strokeDashoffset = '0';
                holdTimer = setInterval(function() {
                    var elapsed = Date.now() - holdStartTime;
                    if (elapsed >= 500) wrap.classList.add('held');
                    if (elapsed >= HOLD_MS) {
                        clearInterval(holdTimer);
                        holdTimer = null;
                        triggered = true;
                        wrap.style.display = 'none';
                        startAutoPlay();
                    }
                }, 100);
            }
            function onUp(e) {
                if (isAndroid) return;
                var wasHolding = !!holdTimer;
                if (holdTimer) {
                    clearInterval(holdTimer);
                    holdTimer = null;
                }
                if (triggered) return;
                wrap.classList.remove('held');
                if (wasHolding) {
                    if (typeof stopBgMusic === 'function') {
                        try { stopBgMusic(); } catch (_) {}
                    }
                    ringFill.style.transition = 'stroke-dashoffset 0.3s ease';
                    ringFill.style.strokeDashoffset = '163.36';
                }
            }

            wrap.onpointerdown = onDown;
            wrap.onpointerup = onUp;
            wrap.onpointercancel = onUp;
            wrap.onpointerleave = onUp;
        }

        async function startAutoPlay() {
            isScatterPhase = false;
            const morphTexts = (cfg.morphTexts && cfg.morphTexts.length) ? cfg.morphTexts : ['happy', "women's day", 'em iu'];
            for (const text of morphTexts) {
                showText(text);
                await sleep(MORPH_WAIT_MS + SEQUENCE_HOLD_MS);
            }

            if (_preloadedImg) {
                // ── Có ảnh: morph chữ → ảnh 80k hạt ──
                const imgLow = generateFromImage(_preloadedImg, AUTOPLAY_TEXT_COUNT, CONFIG.textShapeSize);
                if (imgLow) {
                    bloomPass.strength = 0.22;
                    bloomPass.threshold = 0.35;
                    const count = imgLow.positions.length / 3;
                    if (particleSystem && particleCount === count) {
                        startMorphToResult(imgLow);
                    } else {
                        rebuildParticleSystemForImage(imgLow);
                    }
                }
                await sleep(MORPH_WAIT_MS + 500);

                // Hiển thị ảnh 2D đè lên canvas (không qua bloom → nét, không lóa)
                isMorphing = false;
                morphImageOverlay = createMorphImageOverlay(_preloadedImg);
                morphOverlayFadeStartTime = clock.getElapsedTime();
                await sleep(MORPH_OVERLAY_FADE_MS + MORPH_OVERLAY_HOLD_MS);
            } else {
                // ── Không có ảnh: chờ ngắn rồi nổ luôn ──
                await sleep(600);
            }

            triggerExplosion();
            // Preview mục "hiệu ứng hạt": dừng sau khi vỡ, không sang quả cầu/thư.
            
            if (enableSphere) {
                startSpherePhase();
            } else if (enableLetter) {
                await sleep(3500);
                startCupidLetterSequence();
            }
        }

        let isScatterPhase = false; // true khi đang ở trạng thái hạt trôi nổi ban đầu

        // ── Explosion ──────────────────────────────────────────────────────
        let isExploding = false;
        let explodeStartTime = 0;
        let explodeVelocities = null;
        let explodeStartPositions = null;

        function triggerExplosion() {
            if (!particleSystem || particleCount === 0) return;
            isMorphing = false;
            removeMorphImageOverlay();
            isExploding = true;
            explodeStartTime = clock.getElapsedTime();
            explodeVelocities = new Float32Array(particleCount * 3);
            explodeStartPositions = new Float32Array(sourcePositions);
            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                const dir = new THREE.Vector3(
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.2) * 2
                ).normalize();
                const speed = 4 + Math.random() * 14;
                explodeVelocities[i3]     = dir.x * speed;
                explodeVelocities[i3 + 1] = dir.y * speed;
                explodeVelocities[i3 + 2] = dir.z * speed;
            }
        }

        function animate() {
            requestAnimationFrame(animate);
            if (!isInitialized) return;
            const elapsedTime = clock.getElapsedTime();
            const deltaTime = clock.getDelta();
            controls.update();
            if (particlesGeometry && particleCount > 0) {
                const positions = particlesGeometry.attributes.position.array;
                const effectStrengths = particlesGeometry.attributes.aEffectStrength.array;
                updateIdleAnimation(positions, effectStrengths, elapsedTime, deltaTime);
                particlesGeometry.attributes.position.needsUpdate = true;
            }
            if (backgroundParticlesGeometry && backgroundSourcePositions) {
                const pos = backgroundParticlesGeometry.attributes.position.array;
                for (let i = 0; i < BACKGROUND_SCATTER_COUNT; i++) {
                    const i3 = i * 3;
                    sourceVec.fromArray(backgroundSourcePositions, i3);
                    const drift = 0.2;
                    pos[i3]     = sourceVec.x + noise3D(sourceVec.x * 0.4, sourceVec.y * 0.4, elapsedTime * 0.18) * drift;
                    pos[i3 + 1] = sourceVec.y + noise3D(sourceVec.y * 0.4, sourceVec.z * 0.4, elapsedTime * 0.18) * drift;
                    pos[i3 + 2] = sourceVec.z + noise3D(sourceVec.z * 0.4, sourceVec.x * 0.4, elapsedTime * 0.18) * drift;
                }
                backgroundParticlesGeometry.attributes.position.needsUpdate = true;
            }
            if (morphImageOverlay && morphOverlayFadeStartTime != null && morphImageOverlay.material) {
                const t = (elapsedTime - morphOverlayFadeStartTime) / (MORPH_OVERLAY_FADE_MS / 1000);
                if (t >= 1) {
                    morphImageOverlay.material.opacity = 1;
                    morphOverlayFadeStartTime = null;
                } else {
                    morphImageOverlay.material.opacity = t * t * (3 - 2 * t);
                }
            }
            if (spPhase) updateSpherePhase();
            if (cupidLetterState === 'flying') updateCupidFly();

            if (spPhase) {
                // Sphere phase: bypass composer/bloom hoàn toàn để màu ảnh hiển thị đúng như gốc
                renderer.render(scene, camera);
            } else if (morphImageOverlay) {
                // Selective bloom: bloom chỉ chạy layer 0 (hạt), ảnh (layer 1) render sau không qua bloom
                camera.layers.disable(1);
                composer.render(deltaTime);
                camera.layers.enable(1);
                // Vẽ layer 1 lên trên không qua bloom
                camera.layers.disable(0);
                renderer.autoClear = false;
                renderer.render(scene, camera);
                renderer.autoClear = true;
                camera.layers.enable(0);
            } else {
                composer.render(deltaTime);
            }
        }

        function updateIdleAnimation(positions, effectStrengths, elapsedTime, deltaTime) {
            if (isExploding && explodeVelocities && explodeStartPositions) {
                const t = elapsedTime - explodeStartTime;
                for (let i = 0; i < particleCount; i++) {
                    const i3 = i * 3;
                    positions[i3]     = explodeStartPositions[i3]     + explodeVelocities[i3]     * t;
                    positions[i3 + 1] = explodeStartPositions[i3 + 1] + explodeVelocities[i3 + 1] * t;
                    positions[i3 + 2] = explodeStartPositions[i3 + 2] + explodeVelocities[i3 + 2] * t;
                }
                return;
            }
            if (isMorphing && targetPositions && targetPositions[0]) {
                const t = Math.min(1, (elapsedTime - morphStartTime) / CONFIG.morphDuration);
                const smoothT = t * t * (3 - 2 * t);
                const target = targetPositions[0];
                for (let i = 0; i < particleCount; i++) {
                    const i3 = i * 3;
                    positions[i3] = sourcePositions[i3] + (target[i3] - sourcePositions[i3]) * smoothT;
                    positions[i3 + 1] = sourcePositions[i3 + 1] + (target[i3 + 1] - sourcePositions[i3 + 1]) * smoothT;
                    positions[i3 + 2] = sourcePositions[i3 + 2] + (target[i3 + 2] - sourcePositions[i3 + 2]) * smoothT;
                }
                if (t >= 1) {
                    isMorphing = false;
                    sourcePositions = new Float32Array(target);
                }
                return;
            }

            // drift nhẹ cho hạt scatter (chỉ khi chưa bắt đầu sequence, isScatterPhase)
            const driftAmt = isScatterPhase ? 0.25 : 0;
            let needsEffectStrengthReset = false;
            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                sourceVec.fromArray(sourcePositions, i3);
                if (driftAmt > 0) {
                    positions[i3]     = sourceVec.x + noise3D(sourceVec.x * 0.4, sourceVec.y * 0.4, elapsedTime * 0.18) * driftAmt;
                    positions[i3 + 1] = sourceVec.y + noise3D(sourceVec.y * 0.4, sourceVec.z * 0.4, elapsedTime * 0.18) * driftAmt;
                    positions[i3 + 2] = sourceVec.z + noise3D(sourceVec.z * 0.4, sourceVec.x * 0.4, elapsedTime * 0.18) * driftAmt;
                } else {
                    positions[i3] = sourceVec.x;
                    positions[i3 + 1] = sourceVec.y;
                    positions[i3 + 2] = sourceVec.z;
                }
                if (effectStrengths[i] !== 0.0) {
                    effectStrengths[i] = 0.0;
                    needsEffectStrengthReset = true;
                }
            }
            if (needsEffectStrengthReset) {
                particlesGeometry.attributes.aEffectStrength.needsUpdate = true;
            }
        }

        function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
        }

        // ════════════════════════════════════════════════════════════════
        // SPHERE PHASE
        // ════════════════════════════════════════════════════════════════
        const SPHERE_IMAGES = (cfg.sphereImages && cfg.sphereImages.length) ? cfg.sphereImages : [];
        const SP_RADIUS = 6, SP_ROWS = 6, SP_POLAR_MARGIN = 0.15;
        const SP_INTRO_RADIUS = 16, SP_INTRO_DURATION_MS = 2800, SP_INTRO_STAGGER_MS = 900;
        const SP_HINT_DELAY_MS = 5000, SP_HINT_DURATION_MS = 3000;
        const SP_FLYOUT_BOUND = 10, SP_RAIN_SPEED = 0.025, SP_RAIN_COUNT = 450;
        const SP_DRAG_THRESHOLD = 6;
        const isMobileSP = window.innerWidth < 768;

        let spPhase = false, spGroup = null, spMeshes = [], spTextures = [], spSphereImageUrls = [];
        let spPhiStart, spPhiEnd, spPhiRange;
        let spIntroStartTime = 0, spIntroComplete = false, spIntroCompleteTime = 0;
        let spClickSphere = null, spRaycaster = null, spMouse = null;
        let spHintClickShown = false, spHintFlyShown = false;
        let spHasZoomedIn = false, spNeedZoomIn = false, spZoomInTime = 0;
        const spZoomInTarget = new THREE.Vector3();
        let spIsExploded = false, spExplosionProgress = 0, spExplosionStartTime = 0;
        let spFadeProgress = 0, spFloatingImages = [], spFloatingGroup = null;
        let spDriftTiltAngle = 0, spDriftTiltDir = 1;
        let spIsFinalFlyUp = false, spFinalFlyUpStartTime = 0;
        let spTime = 0, spParticlesMesh = null, spRainMesh = null, spRainPositions = null;
        let spIsPointerDown = false, spWasDrag = false, spMouseDownX = 0, spMouseDownY = 0;
        let cupidLetterState = 'hidden';
        let cupidFlyStartTime = 0;
        const CUPID_FLY_DURATION_MS = 2000;
        const CUPID_LETTER_TEXT = (cfg.letter && cfg.letter.text) ? cfg.letter.text : "Happy Women's Day!\n\nEm iu, chúc em luôn xinh đẹp và hạnh phúc.";

        function spRandOnSphere(r) {
            const t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
            return new THREE.Vector3(r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t));
        }

        function spCreatePatch(r, t0, t1, p0, p1, ws, hs) {
            const geo = new THREE.BufferGeometry();
            const verts = [], uvs = [], idx = [];
            for (let y = 0; y <= hs; y++) {
                const v = y / hs, phi = p0 + v * (p1 - p0);
                for (let x = 0; x <= ws; x++) {
                    const u = x / ws, theta = t0 + u * (t1 - t0);
                    verts.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
                    uvs.push(u, 1 - v);
                }
            }
            for (let y = 0; y < hs; y++) for (let x = 0; x < ws; x++) {
                const a = y * (ws + 1) + x, b = a + 1, c = a + (ws + 1), d = c + 1;
                idx.push(a, c, b, b, c, d);
            }
            geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            return geo;
        }

        function spBuildSphere() {
            let imgIdx = 0, midIdx = 0;
            const midRows = [2, 3];
            spPhiStart = Math.PI * SP_POLAR_MARGIN;
            spPhiEnd   = Math.PI * (1 - SP_POLAR_MARGIN);
            spPhiRange = spPhiEnd - spPhiStart;
            const len = spTextures.length;
            for (let row = 0; row < SP_ROWS; row++) {
                const p1 = spPhiStart + (row / SP_ROWS) * spPhiRange;
                const p2 = spPhiStart + ((row + 1) / SP_ROWS) * spPhiRange;
                const pMid = (p1 + p2) / 2;
                const circ = 2 * Math.PI * SP_RADIUS * Math.sin(pMid);
                const imgH = spPhiRange * SP_RADIUS / SP_ROWS;
                const n = Math.max(3, Math.round(circ / imgH));
                const tStep = (2 * Math.PI) / n;
                for (let col = 0; col < n; col++) {
                    const t = col * tStep;
                    let tex;
                    if (midRows.includes(row)) { tex = spTextures[midIdx % len]; midIdx++; }
                    else { tex = spTextures[imgIdx % len]; imgIdx++; }
                    const geo = spCreatePatch(SP_RADIUS, t, t + tStep, p1, p2, 12, 12);
                    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 1 });
                    const mesh = new THREE.Mesh(geo, mat);
                    const startPos = spRandOnSphere(SP_INTRO_RADIUS);
                    mesh.userData.introStartPos = startPos;
                    mesh.userData.introDelay = Math.random() * SP_INTRO_STAGGER_MS;
                    mesh.position.copy(startPos);
                    spGroup.add(mesh);
                    spMeshes.push(mesh);
                }
            }
            spIntroStartTime = Date.now();
        }

        function spGlowTexture(size) {
            const c = document.createElement('canvas'); c.width = c.height = size;
            const ctx = c.getContext('2d'), cx = size / 2;
            const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
            g.addColorStop(0, 'rgba(255,105,180,1)'); g.addColorStop(0.2, 'rgba(255,182,193,0.85)');
            g.addColorStop(0.45, 'rgba(255,105,180,0.5)'); g.addColorStop(0.7, 'rgba(255,105,180,0.2)');
            g.addColorStop(1, 'rgba(255,105,180,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
            return new THREE.CanvasTexture(c);
        }

        function spRoundedRectGeo(w, h, radius) {
            const shape = new THREE.Shape();
            const x = -w/2, y = -h/2;
            shape.moveTo(x + radius, y); shape.lineTo(x + w - radius, y);
            shape.quadraticCurveTo(x + w, y, x + w, y + radius);
            shape.lineTo(x + w, y + h - radius);
            shape.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            shape.lineTo(x + radius, y + h);
            shape.quadraticCurveTo(x, y + h, x, y + h - radius);
            shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
            const geo = new THREE.ShapeGeometry(shape);
            const pos = geo.attributes.position, uvsArr = [];
            for (let i = 0; i < pos.count; i++) uvsArr.push((pos.getX(i) + w/2) / w, (pos.getY(i) + h/2) / h);
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvsArr, 2));
            return geo;
        }

        function spCreateFloatingImages() {
            spFloatingGroup = new THREE.Group(); scene.add(spFloatingGroup);
            const total = 40, grid = 16, used = [];
            const glowTex = spGlowTexture(128);
            function validPos(x, y, z, d) { return used.every(p => Math.hypot(x-p.x, y-p.y, z-p.z) >= d); }
            function findPos(size) {
                const d = size * 1.5 + 1;
                for (let i = 0; i < 100; i++) {
                    const x = (Math.random()-.5)*grid, y = (Math.random()-.5)*grid, z = (Math.random()-.5)*grid;
                    if (validPos(x,y,z,d)) { used.push({x,y,z}); return {x,y,z}; }
                }
                const a = Math.random()*Math.PI*2, dist = grid/2 + Math.random()*2;
                return { x: Math.cos(a)*dist, y: (Math.random()-.5)*grid, z: Math.sin(a)*dist };
            }
            for (let i = 0; i < total; i++) {
                const ti = i % spTextures.length;
                const tex = spTextures[ti];
                const imgUrl = (spSphereImageUrls[ti] || '').toString();
                const isDefaultImage = imgUrl.indexOf('imagedefault') !== -1;
                const sv = 0.5 + Math.random() * 2, w = 1.5*sv, h = 1*sv, cr = 0.15*sv;
                const ig = new THREE.Group();
                let goMat = null, gMat = null;
                if (!isDefaultImage) {
                    goMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
                    ig.add(new THREE.Mesh(spRoundedRectGeo(w*2.2, h*2.2, cr*2.2), goMat));
                    gMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
                    ig.add(new THREE.Mesh(spRoundedRectGeo(w*1.5, h*1.5, cr*1.5), gMat));
                }
                const iMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0 });
                ig.add(new THREE.Mesh(spRoundedRectGeo(w, h, cr), iMat));
                const tPhi = Math.acos(2*Math.random()-1), tTheta = Math.random()*Math.PI*2;
                ig.position.set(SP_RADIUS*.5*Math.sin(tPhi)*Math.cos(tTheta), SP_RADIUS*.5*Math.cos(tPhi), SP_RADIUS*.5*Math.sin(tPhi)*Math.sin(tTheta));
                const tp = findPos(Math.max(w,h));
                ig.userData = { startPos: ig.position.clone(), targetPos: new THREE.Vector3(tp.x,tp.y,tp.z),
                    floatSpeedY: 0.3+Math.random()*0.5, floatAmplY: 0.1+Math.random()*0.2,
                    floatPhase: Math.random()*Math.PI*2, delay: Math.random()*0.5,
                    basePos: new THREE.Vector3(tp.x,tp.y,tp.z), iMat, gMat, goMat,
                    driftSpeed: 0.002+Math.random()*0.003, baseZ: tp.z, noGlow: isDefaultImage };
                spFloatingGroup.add(ig); spFloatingImages.push(ig);
            }
        }

        function spTriggerExplosion() {
            if (spIsExploded) return;
            spIsExploded = true; spExplosionProgress = 0; spFadeProgress = 0;
            spMeshes.forEach(m => { if (m.material) m.material.transparent = true; });
            spExplosionStartTime = Date.now();
            controls.autoRotate = false; controls.enableRotate = true; controls.maxDistance = 14;
            if (enableSphereFlyingImages) {
                spCreateFloatingImages();
            }
            if (enableLetter) {
                if (enableSphereFlyingImages) {
                    document.getElementById('btn-flying-corner').classList.add('visible');
                } else {
                    // Ảnh bay tắt + thư bật: click lần 2 vào quả cầu → chuyển thẳng sang hiện thư
                    const flash = document.createElement('div');
                    flash.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle,rgba(255,105,180,0.8) 0%,transparent 70%);pointer-events:none;z-index:1000;animation:flashFade 1s ease-out forwards;';
                    document.body.appendChild(flash);
                    setTimeout(() => { flash.remove(); startCupidLetterSequence(); }, 900);
                    return;
                }
            }
            const flash = document.createElement('div');
            flash.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle,rgba(255,105,180,0.8) 0%,transparent 70%);pointer-events:none;z-index:1000;animation:flashFade 1s ease-out forwards;';
            document.body.appendChild(flash);
            setTimeout(() => flash.remove(), 1000);
        }

        function spShowHint(text) {
            const el = document.getElementById('sphere-click-hint');
            if (!el) return;
            el.innerText = text;
            el.classList.add('visible');
            setTimeout(() => el.classList.remove('visible'), SP_HINT_DURATION_MS);
        }

        function spHandleTap(cx, cy) {
            spMouse.x = (cx / window.innerWidth) * 2 - 1;
            spMouse.y = -(cy / window.innerHeight) * 2 + 1;
            spRaycaster.setFromCamera(spMouse, camera);
            if (spIsExploded || !spIntroComplete) return;
            if (spWasDrag) { spWasDrag = false; return; }
            spWasDrag = false;
            const hits = spRaycaster.intersectObject(spClickSphere);
            if (hits.length > 0) {
                document.getElementById('sphere-click-hint').classList.remove('visible');
                if (!spHasZoomedIn) {
                    spHasZoomedIn = true; spZoomInTime = Date.now(); spNeedZoomIn = true;
                    const dir = camera.position.clone().sub(controls.target).normalize();
                    spZoomInTarget.copy(controls.target).add(dir.multiplyScalar(controls.minDistance));
                } else {
                    spTriggerExplosion();
                }
            }
        }

        function startCupidLetterSequence() {
            const overlay = document.getElementById('cupid-letter-overlay');
            const cupidImg = document.getElementById('cupid-flying-img');
            const letterFrame = document.getElementById('cupid-letter-frame');
            if (!overlay || !cupidImg || !letterFrame) return;
            cupidLetterState = 'flying';
            cupidFlyStartTime = Date.now();
            overlay.classList.add('visible');
            cupidImg.style.display = '';
            const startLeft = window.innerWidth * 0.15;
            const startTop = window.innerHeight * 0.85;
            cupidImg.style.left = startLeft + 'px';
            cupidImg.style.top = startTop + 'px';
            cupidImg.style.opacity = '1';
            cupidImg.style.transition = 'none';
            letterFrame.classList.remove('visible');
            document.getElementById('letter-envelope-img')?.classList.remove('visible');
        }

        function updateCupidFly() {
            if (cupidLetterState !== 'flying') return;
            const elapsed = Date.now() - cupidFlyStartTime;
            const progress = Math.min(1, elapsed / CUPID_FLY_DURATION_MS);
            const eased = 1 - Math.pow(1 - progress, 1.2);
            const cupidImg = document.getElementById('cupid-flying-img');
            if (!cupidImg) return;
            const startLeft = window.innerWidth * 0.15;
            const startTop = window.innerHeight * 0.85;
            const endLeft = window.innerWidth * 0.5;
            const endTop = window.innerHeight * 0.5;
            cupidImg.style.left = (startLeft + (endLeft - startLeft) * eased) + 'px';
            cupidImg.style.top = (startTop + (endTop - startTop) * eased) + 'px';
            cupidImg.style.transition = 'none';
            if (progress >= 1) {
                cupidLetterState = 'letterImage';
                cupidImg.style.transition = 'opacity 0.5s ease-out';
                cupidImg.style.opacity = '0';
                setTimeout(() => {
                    cupidImg.style.display = 'none';
                    document.getElementById('letter-envelope-img')?.classList.add('visible');
                }, 500);
            }
        }

        function startLetterTypingEffect(letterContent, cursor) {
            const text = CUPID_LETTER_TEXT;
            const TYPING_SPEED_MS = 50;
            const NEWLINE_DELAY_MS = 5 * TYPING_SPEED_MS;
            const chars = Array.from(text);
            let currentIndex = 0;
            function typeNextChar() {
                if (currentIndex < chars.length) {
                    const char = chars[currentIndex];
                    letterContent.insertBefore(document.createTextNode(char), cursor);
                    currentIndex++;
                    if (char === '\n') {
                        cursor.scrollIntoView({ block: 'nearest', behavior: 'auto' });
                    }
                    const delay = char === '\n' ? NEWLINE_DELAY_MS : TYPING_SPEED_MS;
                    setTimeout(typeNextChar, delay);
                } else {
                    setTimeout(() => {
                        if (cursor) cursor.style.display = 'none';
                        letterContent.classList.add('typing-complete');
                        const letterImageUrl = (cfg.letter && cfg.letter.image && String(cfg.letter.image).trim()) ? cfg.letter.image : '';
                        const captionText = (cfg.letter && cfg.letter.caption != null) ? String(cfg.letter.caption).trim() : '';
                        const wrap = document.getElementById('letterImageWrap');
                        const imgEl = document.getElementById('letterInlineImage');
                        const captionEl = wrap?.querySelector('.letter-image-caption');
                        if (wrap) {
                            if (letterImageUrl && imgEl) {
                                imgEl.src = letterImageUrl;
                                imgEl.style.display = 'block';
                            } else if (imgEl) {
                                imgEl.style.display = 'none';
                            }
                            if (captionEl) {
                                captionEl.textContent = captionText || '';
                                captionEl.style.display = captionText ? 'block' : 'none';
                            }
                            if (letterImageUrl || captionText) {
                                wrap.style.display = 'block';
                                wrap.classList.remove('visible');
                                requestAnimationFrame(() => { wrap.classList.add('visible'); });
                            }
                        }
                    }, 400);
                }
            }
            setTimeout(typeNextChar, 300);
        }

        function handleLetterEnvelopeClick() {
            if (cupidLetterState !== 'letterImage') return;
            cupidLetterState = 'showingLetter';
            if (typeof startBgMusic === 'function') {
                try { startBgMusic(); } catch (_) {}
            }
            document.getElementById('letter-envelope-img')?.classList.remove('visible');
            const letterFrame = document.getElementById('cupid-letter-frame');
            const letterContent = letterFrame?.querySelector('.letter-content');
            const letterImageWrap = document.getElementById('letterImageWrap');
            const letterInlineImage = document.getElementById('letterInlineImage');
            if (letterImageWrap && letterInlineImage) {
                letterImageWrap.style.display = 'none';
                letterImageWrap.classList.remove('visible');
                letterInlineImage.src = '';
            }
            if (letterFrame && letterContent) {
                letterContent.textContent = '';
                letterContent.classList.remove('typing-complete');
                const cursor = document.createElement('span');
                cursor.className = 'letter-cursor';
                letterContent.appendChild(cursor);
                // Ép tải font trước khi hiện lá thư (iOS thường không tải font cho nội dung chèn bằng JS)
                var fontReady = document.fonts.load('1em PacificoLocal').catch(function() {});
                var timeout = new Promise(function(r) { setTimeout(r, 1800); });
                Promise.race([fontReady, timeout]).then(function() {
                    letterFrame.classList.add('visible');
                    startLetterTypingEffect(letterContent, cursor);
                });
            }
        }

        async function startSpherePhase() {
            // Nếu trước đó có hiệu ứng hạt thì chờ 3.4s để xem explosion,
            // còn nếu bỏ morph (chỉ quả cầu) thì không cần chờ.
            // Preview mục "ảnh" (__pvFastSphere) → vào sphere ngay, không chờ.
            if (enableMorphEffect) {
                await sleep(3400);
            } else {
                await sleep(0);
            }
            // fade to black
            const overlay = document.getElementById('transition-overlay');
            overlay.style.opacity = '1';
            await sleep(400);

            // cleanup particles (main + nền 5k) và overlay ảnh morph
            removeMorphImageOverlay();
            if (particleSystem) { scene.remove(particleSystem); particlesGeometry.dispose(); particlesMaterial.dispose(); }
            particleSystem = null; particleCount = 0;
            if (backgroundParticleSystem) {
                scene.remove(backgroundParticleSystem);
                backgroundParticlesGeometry.dispose();
                backgroundParticlesMaterial.dispose();
                backgroundParticleSystem = null;
                backgroundParticlesGeometry = null;
                backgroundParticlesMaterial = null;
                backgroundSourcePositions = null;
            }
            scene.fog = null;
            scene.background = new THREE.Color(0x000000);
            bloomPass.strength = 0; bloomPass.threshold = 1;
            // Match r128 LinearEncoding behavior: raw sRGB values pass through unchanged
            renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

            // reset camera & controls for sphere
            camera.fov = 75; camera.updateProjectionMatrix();
            if (isMobileSP) {
                camera.position.set(0, 0, 16);
            } else {
                camera.position.set(0, 0, 10);
            }
            camera.lookAt(0, 0, 0);
            controls.target.set(0, 0, 0);
            controls.enableRotate = false; controls.enableZoom = true; controls.enablePan = false;
            controls.minDistance = isMobileSP ? 5 : 6; controls.maxDistance = isMobileSP ? 24 : 18;
            controls.autoRotate = false;
            controls.minPolarAngle = Math.PI * 0.25; controls.maxPolarAngle = Math.PI * 0.75;
            controls.minAzimuthAngle = -Math.PI * 0.45; controls.maxAzimuthAngle = Math.PI * 0.45;
            controls.update();

            // hide start-wrap, info panel
            document.getElementById('start-wrap').style.display = 'none';
            document.getElementById('ui').style.display = 'none';

            // build sphere objects
            spGroup = new THREE.Group(); scene.add(spGroup);
            spClickSphere = new THREE.Mesh(
                new THREE.SphereGeometry(SP_RADIUS * 1.1, 32, 32),
                new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
            );
            spClickSphere.renderOrder = -1; scene.add(spClickSphere);
            spRaycaster = new THREE.Raycaster(); spMouse = new THREE.Vector2();

            // sphere particles halo
            const sCnt = 600, sPos = new Float32Array(sCnt*3), sCol = new Float32Array(sCnt*3);
            for (let i = 0; i < sCnt; i++) {
                const t2 = Math.random()*Math.PI*2, p2 = Math.acos(2*Math.random()-1), r2 = SP_RADIUS*1.2+Math.random()*3;
                sPos[i*3]=r2*Math.sin(p2)*Math.cos(t2); sPos[i*3+1]=r2*Math.cos(p2); sPos[i*3+2]=r2*Math.sin(p2)*Math.sin(t2);
                sCol[i*3]=1; sCol[i*3+1]=0.4+Math.random()*0.3; sCol[i*3+2]=0.7+Math.random()*0.3;
            }
            const sGeo = new THREE.BufferGeometry();
            sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
            sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
            spParticlesMesh = new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 0.04, vertexColors: true, transparent: true, opacity: 0.8 }));
            scene.add(spParticlesMesh);

            // rain up
            const rPos = new Float32Array(SP_RAIN_COUNT*3), rCol = new Float32Array(SP_RAIN_COUNT*3);
            for (let i = 0; i < SP_RAIN_COUNT; i++) {
                rPos[i*3]=(Math.random()-.5)*2*SP_FLYOUT_BOUND; rPos[i*3+1]=-SP_FLYOUT_BOUND+Math.random()*2*SP_FLYOUT_BOUND; rPos[i*3+2]=(Math.random()-.5)*2*SP_FLYOUT_BOUND;
                rCol[i*3]=1; rCol[i*3+1]=0.4+Math.random()*0.3; rCol[i*3+2]=0.7+Math.random()*0.3;
            }
            spRainPositions = rPos;
            const rGeo = new THREE.BufferGeometry();
            rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
            rGeo.setAttribute('color', new THREE.BufferAttribute(rCol, 3));
            spRainMesh = new THREE.Points(rGeo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.75 }));
            spRainMesh.renderOrder = 998; scene.add(spRainMesh);

            // CSS particles background
            const bg = document.getElementById('sphere-particles-bg');
            for (let i = 0; i < 30; i++) {
                const d = document.createElement('div'); d.className = 'sp-particle';
                d.style.left = Math.random()*100+'%'; d.style.animationDelay = Math.random()*15+'s';
                d.style.animationDuration = (10+Math.random()*10)+'s'; bg.appendChild(d);
            }
            bg.style.opacity = '1';

            // load textures then build sphere
            const loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
            Promise.all(SPHERE_IMAGES.map(url => new Promise(res => loader.load(url, res, undefined, () => res(null)))))
            .then(textures => {
                spTextures = [];
                spSphereImageUrls = [];
                SPHERE_IMAGES.forEach((url, i) => { if (textures[i]) { spTextures.push(textures[i]); spSphereImageUrls.push(url); } });
                if (!spTextures.length) {
                    const fc = document.createElement('canvas'); fc.width = fc.height = 64;
                    fc.getContext('2d').fillStyle = '#ff69b4'; fc.getContext('2d').fillRect(0,0,64,64);
                    spTextures = [new THREE.CanvasTexture(fc)];
                    spSphereImageUrls = [];
                }
                // Match r128: treat textures as linear (no sRGB decode) — raw values pass through
                spTextures.forEach(t => { t.colorSpace = THREE.LinearSRGBColorSpace; t.needsUpdate = true; });
                spBuildSphere();
                spPhase = true;

                // tap handlers
                const canvasEl = renderer.domElement;
                function spDown(e) { const c = e.touches?.[0]||e; spMouseDownX=c.clientX; spMouseDownY=c.clientY; spIsPointerDown=true; spWasDrag=false; }
                function spMove(e) { const c = e.touches?.[0]||e; if (spIsPointerDown) { if (Math.hypot(c.clientX-spMouseDownX,c.clientY-spMouseDownY)>SP_DRAG_THRESHOLD) spWasDrag=true; } }
                function spUp() { spIsPointerDown=false; }
                canvasEl.addEventListener('mousedown', spDown); canvasEl.addEventListener('mouseup', spUp);
                canvasEl.addEventListener('mouseleave', spUp); canvasEl.addEventListener('mousemove', spMove);
                canvasEl.addEventListener('click', e => spHandleTap(e.clientX, e.clientY));
                canvasEl.addEventListener('touchstart', spDown, {passive:true}); canvasEl.addEventListener('touchmove', spMove, {passive:true});
                canvasEl.addEventListener('touchend', e => { spUp(); if(e.cancelable)e.preventDefault(); const c=e.changedTouches[0]; spHandleTap(c.clientX,c.clientY); }, {passive:false});

                document.getElementById('btn-flying-corner').addEventListener('click', () => {
                    if (!spIsExploded || spIsFinalFlyUp) return;
                    spIsFinalFlyUp = true; spFinalFlyUpStartTime = Date.now();
                    document.getElementById('sphere-click-hint').classList.remove('visible');
                    document.getElementById('btn-flying-corner').classList.remove('visible');
                    bg.style.opacity = '0';
                    startCupidLetterSequence();
                });

                // fade overlay out
                overlay.style.opacity = '0';
            });
        }

        function updateSpherePhase() {
            spTime += 0.01;
            // hints
            if (spIntroComplete && !spHintClickShown && spIntroCompleteTime > 0 && (Date.now()-spIntroCompleteTime) >= SP_HINT_DELAY_MS) { spHintClickShown=true; spShowHint('Click vào nhé'); }
            if (spHasZoomedIn && !spIsExploded && !spHintFlyShown && spZoomInTime > 0 && (Date.now()-spZoomInTime) >= SP_HINT_DELAY_MS) { spHintFlyShown=true; spShowHint('Click lần nữa nào'); }
            // rain
            if (spRainMesh && spRainPositions) {
                const n = spRainPositions.length/3;
                for (let j = 0; j < n; j++) {
                    spRainPositions[j*3+1] += SP_RAIN_SPEED;
                    if (spRainPositions[j*3+1] > 6) { spRainPositions[j*3+1]=-SP_FLYOUT_BOUND; spRainPositions[j*3]=(Math.random()-.5)*2*SP_FLYOUT_BOUND; spRainPositions[j*3+2]=(Math.random()-.5)*2*SP_FLYOUT_BOUND; }
                }
                spRainMesh.geometry.attributes.position.needsUpdate = true;
            }
            // explosion / floating
            if (spIsExploded) {
                spExplosionProgress = Math.min(1, spExplosionProgress+0.018);
                spFadeProgress = Math.min(1, spFadeProgress+0.04);
                spGroup.children.forEach(child => { if (child.material) { child.material.opacity = Math.max(0, 1-spFadeProgress); if (child.material.opacity<=0) child.visible=false; } });
                spClickSphere.visible = false;
                if (spFloatingGroup) { spDriftTiltAngle+=spDriftTiltDir*0.0003; if(spDriftTiltAngle>=0.25){spDriftTiltAngle=0.25;spDriftTiltDir=-1;}else if(spDriftTiltAngle<=-0.25){spDriftTiltAngle=-0.25;spDriftTiltDir=1;} spFloatingGroup.rotation.y=spDriftTiltAngle; }
                const maxY=10, minY=-10, fMaxY=25;
                spFloatingImages.forEach((img, idx) => {
                    const d=img.userData, dp=Math.max(0,(spExplosionProgress-d.delay)/(1-d.delay));
                    if (dp>0) {
                        const t=Math.min(1,dp), eased=1-Math.pow(1-t,2);
                        const fY=spIsFinalFlyUp?0:Math.sin(spTime*2*d.floatSpeedY+d.floatPhase)*d.floatAmplY;
                        const elapsed=(Date.now()-spExplosionStartTime)/1000;
                        const FAST=isMobileSP?25:18, FTAPER=isMobileSP?4:2.5, TEND=isMobileSP?7:5;
                        let dm=spIsFinalFlyUp?80:(elapsed<FTAPER?FAST:(elapsed<TEND?FAST-(FAST-1)*(elapsed-FTAPER)/(TEND-FTAPER):1));
                        d.basePos.y+=d.driftSpeed*dm;
                        if (eased<1) { img.position.x=d.startPos.x+(d.targetPos.x-d.startPos.x)*eased; img.position.z=d.startPos.z+(d.targetPos.z-d.startPos.z)*eased; img.position.y=d.startPos.y+(d.targetPos.y-d.startPos.y)*eased+(d.basePos.y-d.targetPos.y)+fY; }
                        else { img.position.x=d.basePos.x; img.position.y=d.basePos.y+fY; img.position.z=d.baseZ; }
                        if (spIsFinalFlyUp) { if(d.basePos.y>=fMaxY) img.visible=false; }
                        else { if (d.basePos.y>maxY) { d.basePos.y=minY; d.basePos.x=(Math.random()-.5)*16; d.baseZ=(Math.random()-.5)*16; img.position.x=d.basePos.x; img.position.z=d.baseZ; } }
                        const op=Math.min(1,dp*2), gp=0.65+Math.sin(spTime*3+idx*0.5)*0.25;
                        d.iMat.opacity=op;
                        if (!d.noGlow && d.gMat && d.goMat) { d.gMat.opacity=Math.min(1,op*gp); d.goMat.opacity=Math.min(1,op*gp*0.75); }
                    }
                });
            } else if (spIntroComplete) {
                if (spNeedZoomIn) { camera.position.lerp(spZoomInTarget, 0.08); if (camera.position.distanceTo(controls.target)<=controls.minDistance+0.05) spNeedZoomIn=false; }
                spGroup.rotation.y += 0.001;
                if (spParticlesMesh) { spParticlesMesh.rotation.y+=0.0005; spParticlesMesh.rotation.x+=0.00025; }
            }
            // intro
            if (!spIntroComplete && spIntroStartTime > 0 && spMeshes.length > 0) {
                const elapsed = Date.now()-spIntroStartTime, dur = SP_INTRO_DURATION_MS/1000;
                spMeshes.forEach(mesh => {
                    const delay=(mesh.userData.introDelay||0)/1000, t=Math.min(1,Math.max(0,(elapsed/1000-delay)/dur));
                    const eased=1-Math.pow(1-t,1.4);
                    mesh.position.lerpVectors(mesh.userData.introStartPos, new THREE.Vector3(0,0,0), eased);
                    if (mesh.material) mesh.material.opacity=1;
                });
                if (elapsed > SP_INTRO_DURATION_MS + SP_INTRO_STAGGER_MS) {
                    spIntroComplete=true; spIntroCompleteTime=Date.now();
                    spMeshes.forEach(m => { m.position.set(0,0,0); if(m.material){m.material.opacity=1;m.visible=true;} });
                }
            }
        }
        // ════════════════════════════════════════════════════════════════

        // ════════════════════════════════════════════════════════════════
        // Áp dụng config vào head (title, icon, passcode UI)
        // ════════════════════════════════════════════════════════════════
        (function applyCfgToDOM() {
            const title = (enableWebsiteInfo && cfg.appTitle) ? cfg.appTitle : 'Món Quà Nhỏ';
            document.title = title;
            const metaTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
            if (metaTitle) metaTitle.content = title;

            const iconSrc = (enableWebsiteInfo && cfg.appIcon) ? cfg.appIcon : 'assets/images/icons/couple.png';
            document.querySelectorAll('link[rel*="apple-touch-icon"], link[rel="icon"]').forEach(el => el.href = iconSrc);

            const passcodeTitle = document.querySelector('.passcode-title');
            const passcodeSubtitle = document.querySelector('.passcode-subtitle');
            if (passcodeTitle && cfg.passcodeTitle) passcodeTitle.textContent = cfg.passcodeTitle;
            if (passcodeSubtitle && cfg.passcodeSubtitle) passcodeSubtitle.textContent = cfg.passcodeSubtitle;
        })();

        // ════════════════════════════════════════════════════════════════
        // NHẠC NỀN
        // ════════════════════════════════════════════════════════════════
        // Khởi động
        init();

        // Listener cho click phong bì lá thư (hoạt động cả khi không có sphere)
        document.getElementById('letter-envelope-img')?.addEventListener('click', handleLetterEnvelopeClick);

        })(); // end async IIFE
    