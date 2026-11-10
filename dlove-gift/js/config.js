// =====================================================================
//  CẤU HÌNH — CHỈNH SỬA Ở ĐÂY: chữ, ảnh, thư, nhạc, bật/tắt hiệu ứng
// =====================================================================
export const APP = {
    appTitle: 'Món Quà Nhỏ',
    appIcon:  'assets/images/icons/phongbi.png',

    // Bật / tắt từng giai đoạn
    enableMorphEffect:        true,  // hạt biến hình thành chữ + ảnh rồi nổ tung
    enableSphere:             true,  // quả cầu ảnh
    enableSphereFlyingImages: true,  // ảnh bay lên sau khi chạm quả cầu lần 2
    enableLetter:             true,  // cupid + phong bì + lá thư

    // Chữ hiện lần lượt bằng hạt
    morphTexts: ['happy', "Chúc Mừng Sinh Nhật", 'cốt iu'],

    // Ảnh biến thành hạt (để '' nếu không dùng)
    particleImage: 'assets/bonghoa.png',

    // Ảnh trên quả cầu (thêm / bớt thoải mái, file không tồn tại sẽ tự bỏ qua)
    sphereImages: [
    'assets/images/sphere/1.jpg',
    'assets/images/sphere/2.jpg',
    'assets/images/sphere/3.jpg',
    'assets/images/sphere/4.jpg',
    'assets/images/sphere/5.jpg',
    'assets/images/sphere/6.jpg',
    'assets/images/sphere/7.jpg',
    'assets/images/sphere/8.jpg',
    'assets/images/sphere/9.jpg'
],

    // Lá thư
    letter: {
        text: `Chúc Mừng Sinh Nhật!

Hép bii bớt đê bạn iuu. Chúc Như Núi sinh nhật vui vẻ, luôn  gặp được những điều may mắn và thuân lời trong học tập.Mong rằng những điều tốt đẹp sẽ đến với mày. Chúc cho mqh của chúng ta sẽ luôn bền chặt mãiiii về sauuu nữa🩷.`,
        image: 'assets/images/letters/thatim.webp',      // ảnh hiện cuối thư, ví dụ 'assets/images/letters/anh-cuoi-thu.jpg'
        caption: '♥'
    },

    // Nhạc nền
    bgMusic:  'musics/tháng năm đẹp nhất cuộc đời.mp3',
    bgVolume: 0.55
};
