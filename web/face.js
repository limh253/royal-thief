// 牌面美术：全部内联 SVG，暗调油画质感 + 鎏金饰框，不依赖任何外部图片，
// 所以单文件版（dist/王权窃贼.html）也能原样显示。
// 画法：每张牌自带 defs（渐变/滤镜 id 以牌型为前缀，避免同页重复），
// 结构固定为 背景 → 主体 → 阴影/氛围 → 饰框 → 颗粒，最后叠 HTML 名牌条。

const C = {
  ink0: '#04060a', ink1: '#0b0f14', ink2: '#151a21', ink3: '#242b34',
  gold: '#d8a83c', goldHi: '#f8e6ad', goldLo: '#4e3510',
  steel: '#9daab8', steelHi: '#eaf2fa', steelLo: '#2a3037', steelMid: '#5d6771',
  skin: '#c08a5c', skinHi: '#e8bd8f', skinLo: '#6b452a',
  clothB: '#33507a', clothBHi: '#5a80b0', clothBLo: '#152437',
  clothR: '#712434', clothRHi: '#a8495a', clothRLo: '#330e16',
  parch: '#d6c49b', parchLo: '#8a7444',
  green: '#2f6b4f', greenHi: '#79c69c', greenLo: '#122b20',
};

// 通用 defs：背景径向、暗角、鎏金、颗粒、柔光
const defs = (p, tone) => `<defs>
<radialGradient id="${p}bg" cx="40%" cy="26%" r="92%">
<stop offset="0%" stop-color="${tone.bg0}"/><stop offset="52%" stop-color="${tone.bg1}"/><stop offset="100%" stop-color="#04060a"/>
</radialGradient>
<linearGradient id="${p}vig" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#000" stop-opacity=".55"/><stop offset="42%" stop-color="#000" stop-opacity="0"/>
<stop offset="100%" stop-color="#000" stop-opacity=".8"/>
</linearGradient>
<linearGradient id="${p}gold" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${C.goldHi}"/><stop offset="34%" stop-color="${C.gold}"/>
<stop offset="72%" stop-color="${C.goldLo}"/><stop offset="100%" stop-color="#241705"/>
</linearGradient>
<linearGradient id="${p}steel" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="${C.steelLo}"/><stop offset="22%" stop-color="${C.steelMid}"/>
<stop offset="48%" stop-color="${C.steelHi}"/><stop offset="62%" stop-color="${C.steel}"/>
<stop offset="100%" stop-color="${C.steelLo}"/>
</linearGradient>
<filter id="${p}soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.1"/></filter>
<filter id="${p}glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.4"/></filter>
<filter id="${p}grain" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>
<feColorMatrix type="saturate" values="0"/></filter>
<filter id="${p}paint" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.055 0.09" numOctaves="4" seed="7" stitchTiles="stitch"/>
<feColorMatrix type="saturate" values="0"/></filter>
<filter id="${p}craze" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.32 0.42" numOctaves="2" seed="11" stitchTiles="stitch"/>
<feColorMatrix type="saturate" values="0"/></filter>
</defs>`;

// 鎏金饰框 + 四角卷草
const frame = (p) => `
<rect x="1.05" y="1.05" width="69.9" height="81.9" rx="5.2" fill="none" stroke="url(#${p}gold)" stroke-width="1.7"/>
<rect x="3.2" y="3.2" width="65.6" height="77.6" rx="3.6" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="1"/>
<g fill="none" stroke="url(#${p}gold)" stroke-width="2.1" stroke-linecap="round">
<path d="M4.6 13.5 L4.6 7.4 Q4.6 4.6 7.4 4.6 L13.5 4.6"/>
<path d="M67.4 13.5 L67.4 7.4 Q67.4 4.6 64.6 4.6 L58.5 4.6"/>
<path d="M4.6 70.5 L4.6 76.6 Q4.6 79.4 7.4 79.4 L13.5 79.4"/>
<path d="M67.4 70.5 L67.4 76.6 Q67.4 79.4 64.6 79.4 L58.5 79.4"/>
</g>
<circle cx="7.6" cy="7.6" r="1.15" fill="url(#${p}gold)"/>
<circle cx="64.4" cy="7.6" r="1.15" fill="url(#${p}gold)"/>
<circle cx="7.6" cy="76.4" r="1.15" fill="url(#${p}gold)"/>
<circle cx="64.4" cy="76.4" r="1.15" fill="url(#${p}gold)"/>`;

const grain = (p) => `<rect x="1" y="1" width="70" height="82" rx="5" filter="url(#${p}grain)" opacity=".24" style="mix-blend-mode:overlay"/>`;
// 油画肌理：粗颗粒软光叠加，压掉矢量图的塑料感
const paint = (p) => `<rect x="1" y="1" width="70" height="82" rx="5" filter="url(#${p}paint)" opacity=".42" style="mix-blend-mode:soft-light"/>`;
// 陈年清漆的冰裂纹 + 斜面反光，像挂在墙上的老油画
const varnish = (p) => `<rect x="1" y="1" width="70" height="82" rx="5" filter="url(#${p}craze)" opacity=".10" style="mix-blend-mode:overlay"/>
<path d="M2 10 L34 2 L26 82 L2 82 Z" fill="#fff6e2" opacity=".05" style="mix-blend-mode:screen"/>
<path d="M40 2 L70 2 L70 40 L34 82 Z" fill="#ffd9a0" opacity=".035" style="mix-blend-mode:screen"/>`;
// 内阴影：把主体压进画框里，边角收到暗部
const innerShade = (p) => `<rect x="4" y="4" width="64" height="76" rx="4" fill="none" stroke="#000" stroke-opacity=".38" stroke-width="4" filter="url(#${p}soft)"/>`;

const svg = (p, tone, inner) => `<svg class="art" viewBox="0 0 72 84" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
${defs(p, tone)}<rect width="72" height="84" rx="6" fill="url(#${p}bg)"/>${inner}
<rect width="72" height="84" rx="6" fill="url(#${p}vig)"/>${paint(p)}${innerShade(p)}${frame(p)}${varnish(p)}${grain(p)}</svg>`;

// 人（善）：提灯的义人，暖光自下方打在脸上
const ART_GOOD = svg('fg', { bg0: '#33404f', bg1: '#111820' }, `
<rect width="72" height="84" fill="#0c1016"/>
<path d="M19 84 L19 33 Q19 12 36 12 Q53 12 53 33 L53 84 Z" fill="#4b4534"/>
<path d="M19 84 L19 33 Q19 12 36 12 Q53 12 53 33 L53 84 Z" fill="#f0d49a" opacity=".2"/>
<path d="M36 12.6 L36 84 M19 46 L53 46" stroke="#0b0e13" stroke-width="1.9" opacity=".9"/>
<path d="M19 33 Q19 12 36 12 Q53 12 53 33" fill="none" stroke="#8a7346" stroke-width="1.1" opacity=".55"/>
<path d="M0 84 L0 0 L19 0 L19 84 Z M53 0 L72 0 L72 84 L53 84 Z" fill="#070a0e"/>
<path d="M19 84 L19 33 Q19 12 36 12 Q53 12 53 33 L53 84 Z" fill="none" stroke="#000" stroke-width="2" stroke-opacity=".55"/>
<ellipse cx="36" cy="84" rx="26" ry="14" fill="#000" opacity=".45" filter="url(#fgsoft)"/>
<circle cx="35" cy="30" r="17" fill="#ffd9a0" opacity=".22" filter="url(#fgglow)"/>
<path d="M26 80 Q24 52 30 44 L36 41 L42 44 Q48 52 46 80 Z" fill="#2b3a4e"/>
<path d="M29 46 Q36 40 43 46 L45 80 L27 80 Z" fill="#3d5470"/>
<path d="M31 48 Q36 44 41 48 L42 80 L30 80 Z" fill="#4a647f" opacity=".85"/>
<path d="M30 46 Q36 42 42 46 L40 54 Q36 51 32 54 Z" fill="#c9b083" opacity=".9"/>
<path d="M33 56 L36 72 M39 56 L37 72" stroke="#22303f" stroke-width=".9" opacity=".7" fill="none"/>
<path d="M15 47 Q23 41 30 45 L28 62 Q21 58 14 61 Z" fill="#2f4258"/>
<path d="M57 47 Q49 41 42 45 L44 62 Q51 58 58 61 Z" fill="#243449"/>
<circle cx="36" cy="31" r="8.4" fill="url(#fggold)" opacity=".25"/>
<path d="M36 20 Q45 21 45 31 Q45 41 36 43 Q27 41 27 31 Q27 21 36 20 Z" fill="${C.skin}"/>
<path d="M36 20 Q45 21 45 31 Q45 41 36 43 Q33 42 31 40 Q38 34 38 24 Z" fill="${C.skinLo}" opacity=".55"/>
<path d="M36 43 Q31 42 28 38 Q33 40 36 39 Q39 40 44 38 Q41 42 36 43 Z" fill="${C.skinHi}" opacity=".5"/>
<path d="M27.5 30 Q28 20.5 36 20 Q44 20.5 44.5 30 Q43 24 36 23.6 Q29 24 27.5 30 Z" fill="#4a3524"/>
<path d="M29.6 30.4 Q31.6 29 33.6 30.4" stroke="#3a2417" stroke-width="1.05" fill="none" stroke-linecap="round"/>
<path d="M38.4 30.4 Q40.4 29 42.4 30.4" stroke="#3a2417" stroke-width="1.05" fill="none" stroke-linecap="round"/>
<circle cx="31.6" cy="32.2" r="1.15" fill="#241a12"/><circle cx="40.4" cy="32.2" r="1.15" fill="#241a12"/>
<circle cx="31.2" cy="31.8" r=".4" fill="#fff" opacity=".8"/><circle cx="40" cy="31.8" r=".4" fill="#fff" opacity=".8"/>
<path d="M35 33 L35 36.6 Q36.2 37 35.4 37.6" stroke="${C.skinLo}" stroke-width=".85" fill="none" stroke-linecap="round"/>
<path d="M33.2 39.4 Q36 40.6 38.8 39.4" stroke="#7d3f38" stroke-width="1" fill="none" stroke-linecap="round"/>
<path d="M36 45.5 L36 50 M33 47.6 L39 47.6" stroke="${C.gold}" stroke-width="1.5" stroke-linecap="round"/>
<g transform="translate(15.5,50)">
<path d="M0 3 L0 -4.6 Q0 -6.4 1.8 -6.4 L4.6 -6.4 Q6.4 -6.4 6.4 -4.6 L6.4 3 Z" fill="url(#fggold)"/>
<rect x="-1.3" y="3" width="9" height="1.7" rx=".8" fill="${C.goldLo}"/>
<path d="M-1.2 -6.4 Q3.2 -9.4 7.6 -6.4" stroke="${C.goldLo}" stroke-width="1.1" fill="none"/>
<circle cx="3.2" cy="-1.6" r="4.6" fill="#ffe6ae" opacity=".55" filter="url(#fgglow)"/>
<circle cx="3.2" cy="-1.6" r="1.9" fill="#fff4cf"/>
</g>
<path d="M9 72 L24 52 L28 55 L13 76 Z" fill="#ffdca4" opacity=".14" filter="url(#fgsoft)"/>
<ellipse cx="36" cy="80" rx="16" ry="3.4" fill="#000" opacity=".55" filter="url(#fgsoft)"/>`);

// 人（恶）：兜帽刺客，右手背在身后握匕首，刀尖自肩后探出
const ART_EVIL = svg('fe', { bg0: '#3a2029', bg1: '#130a0e' }, `
<rect width="72" height="84" fill="#0a0608"/>
<path d="M19 84 L19 33 Q19 12 36 12 Q53 12 53 33 L53 84 Z" fill="#3b2a30"/>
<path d="M19 84 L19 33 Q19 12 36 12 Q53 12 53 33 L53 84 Z" fill="#a4687c" opacity=".16"/>
<path d="M36 12.6 L36 84 M19 46 L53 46" stroke="#080507" stroke-width="1.9" opacity=".9"/>
<path d="M19 33 Q19 12 36 12 Q53 12 53 33" fill="none" stroke="#5e3a44" stroke-width="1.1" opacity=".6"/>
<path d="M0 84 L0 0 L19 0 L19 84 Z M53 0 L72 0 L72 84 L53 84 Z" fill="#050305"/>
<path d="M19 84 L19 33 Q19 12 36 12 Q53 12 53 33 L53 84 Z" fill="none" stroke="#000" stroke-width="2" stroke-opacity=".6"/>
<ellipse cx="36" cy="84" rx="26" ry="14" fill="#000" opacity=".5" filter="url(#fesoft)"/>
<path d="M30 47 Q36 41 42 47 L44 80 L28 80 Z" fill="#3d1a24"/>
<path d="M32 49 Q36 45 40 49 L41 80 L31 80 Z" fill="#4a222d" opacity=".85"/>
<path d="M31 47 Q36 43 41 47 L39 55 Q36 52 33 55 Z" fill="#2a1119"/>
<path d="M14 46 Q22 40 29 45 L27 61 Q20 57 13 60 Z" fill="#2c141c"/>
<path d="M58 45 Q50 39 43 44 L45 61 Q52 57 59 59 Z" fill="#1f0e14"/>
<path d="M44 46 Q54 49 59 57 Q56 60 50 59 Q44 55 42 49 Z" fill="#39161f"/>
<path d="M58 56 L69 41" stroke="url(#festeel)" stroke-width="3.1" stroke-linecap="round"/>
<path d="M58.4 55.6 L69.4 40.6" stroke="#ffffff" stroke-width=".7" opacity=".55" stroke-linecap="round"/>
<path d="M57 57.6 L62.6 60.6" stroke="#2a1a0c" stroke-width="3.4" stroke-linecap="round"/>
<circle cx="68.4" cy="40.2" r="1.5" fill="#ffe9c0" opacity=".85" filter="url(#feglow)"/>
<path d="M27 19 Q37 14 45 22 Q48 30 44 38 Q40 44 36 44 Q30 44 26 38 Q22 27 27 19 Z" fill="#150a0e"/>
<path d="M29 20 Q36 16 43 22 Q45 28 43 34 Q42 26 36 24 Q31 24 29 30 Z" fill="#2a141a"/>
<circle cx="36.6" cy="31.2" r="6.2" fill="#0a0507"/>
<path d="M31.4 32.4 Q36.6 27.6 42 32.4 Q36.6 36.4 31.4 32.4 Z" fill="#1a0d11"/>
<circle cx="36.4" cy="31.6" r="1.75" fill="#c9b48f"/>
<circle cx="36.4" cy="31.6" r=".85" fill="#2a0d0d"/>
<circle cx="35.9" cy="31.1" r=".42" fill="#fff" opacity=".95"/>
<circle cx="40.4" cy="31.4" r="1" fill="#8c2a2a" opacity=".7"/>
<path d="M28 34 Q31 30.6 34 32.6" stroke="#0a0507" stroke-width="1.2" fill="none" stroke-linecap="round"/>
<path d="M39 32.6 Q42 30.6 45 34" stroke="#0a0507" stroke-width="1.2" fill="none" stroke-linecap="round"/>
<path d="M33 40.6 Q36.4 39.6 39.4 40.8" stroke="#5c1f22" stroke-width="1" fill="none" stroke-linecap="round"/>
<path d="M25 19 Q36 11 47 21" stroke="#3d1a22" stroke-width="2.6" fill="none" stroke-linecap="round"/>
<path d="M47 21 Q56 34 52 50" stroke="#431c26" stroke-width="7" fill="none" stroke-linecap="round"/>
<path d="M56 44 Q60 50 58 56" stroke="#5a2731" stroke-width="2" fill="none" opacity=".7"/>
<path d="M20 68 Q26 62 32 74" stroke="#4a1d26" stroke-width="2.4" fill="none" opacity=".6"/>
<path d="M56 40 Q60 36 62 30" stroke="#a8495a" stroke-width="1.4" fill="none" opacity=".55" stroke-linecap="round"/>
<ellipse cx="36" cy="80" rx="15" ry="3.2" fill="#000" opacity=".6" filter="url(#fesoft)"/>`);
// 武器：骑士长剑，剑尖向下，石壁上有一点冷光
const ART_WEAPON = svg('fw', { bg0: '#2c333d', bg1: '#0d1116' }, `
<path d="M0 63 Q36 48 72 63 L72 84 L0 84 Z" fill="#0a0d11" opacity=".7"/>
<circle cx="36" cy="30" r="20" fill="#89a2bd" opacity=".12" filter="url(#fwglow)"/>
<path d="M36 6 L30.6 16 L30.6 47 L36 56 L41.4 47 L41.4 16 Z" fill="url(#fwsteel)"/>
<path d="M36 8 L33 16 L34.4 46 L36 54 L37.6 46 L39 16 Z" fill="#ffffff" opacity=".22"/>
<path d="M36 10 L36 50" stroke="#4e5a66" stroke-width="1.5" opacity=".85"/>
<path d="M36 10 L36 50" stroke="#e9f2fb" stroke-width=".6" opacity=".6"/>
<path d="M31.2 15 L31.2 46 M40.8 15 L40.8 46" stroke="#20262d" stroke-width=".7" opacity=".8"/>
<path d="M36 6 L30.6 16 L31.2 16 L36 7.4 L40.8 16 L41.4 16 Z" fill="#eef5fc" opacity=".85"/>
<path d="M20.5 47 Q36 43.4 51.5 47 L52.4 52.6 Q36 49.2 19.6 52.6 Z" fill="url(#fwgold)"/>
<path d="M20.5 47 Q36 43.4 51.5 47" stroke="#fdf0c4" stroke-width=".8" fill="none" opacity=".8"/>
<path d="M19.6 52.6 Q36 49.2 52.4 52.6" stroke="#3a2708" stroke-width=".8" fill="none" opacity=".9"/>
<path d="M22 47.6 Q19 48.6 18 51.4 Q20 52.6 22.6 52" fill="#8a6420"/>
<path d="M50 47.6 Q53 48.6 54 51.4 Q52 52.6 49.4 52" fill="#8a6420"/>
<rect x="33.4" y="52.6" width="5.2" height="15" rx="2" fill="#43301c"/>
<path d="M34 54 L38.4 57 M34 57.4 L38.4 60.6 M34 60.8 L38.4 64 M34.2 64.2 L38 67" stroke="#7d5c34" stroke-width="1.1" stroke-linecap="round"/>
<circle cx="36" cy="71.4" r="4.6" fill="url(#fwgold)"/>
<circle cx="36" cy="71.4" r="4.6" fill="none" stroke="#3a2708" stroke-width=".7"/>
<circle cx="36" cy="71.4" r="1.9" fill="#8e1f2a"/>
<circle cx="35.4" cy="70.7" r=".6" fill="#ffd2d2" opacity=".85"/>
<path d="M30 80 Q36 76.6 42 80" stroke="#3f4a56" stroke-width="1.2" fill="none" opacity=".6"/>
<ellipse cx="36" cy="79" rx="12" ry="2.4" fill="#000" opacity=".5" filter="url(#fwsoft)"/>`);

// 皇冠：貂裘披肩 + 宝石王冠
const ART_CROWN = svg('fc', { bg0: '#4a3a16', bg1: '#1a1306' }, `
<path d="M0 52 Q36 34 72 52 L72 84 L0 84 Z" fill="#1d0a10"/>
<path d="M22 84 Q24 62 36 58 Q48 62 50 84 Z" fill="#6d2233"/>
<path d="M27 84 Q29 66 36 63 Q43 66 45 84 Z" fill="#8a2c40"/>
<path d="M31 70 Q36 66.6 41 70" stroke="#a8495a" stroke-width="1.1" fill="none" opacity=".7"/>
<path d="M14 62 Q24 52 36 52 Q48 52 58 62 Q52 68 46 66 Q36 62 26 66 Q20 68 14 62 Z" fill="#e6e2d6"/>
<path d="M14 62 Q22 58 26 66 Q20 68 14 62 Z" fill="#efece2"/>
<path d="M58 62 Q50 58 46 66 Q52 68 58 62 Z" fill="#efece2"/>
<path d="M22 63 L24.6 68 M30 61 L31 67 M42 61 L41 67 M50 63 L47.6 68" stroke="#2b2b2b" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="36" cy="57" r="15" fill="#ffd47a" opacity=".16" filter="url(#fcglow)"/>
<path d="M17 49 L17 22 L27.5 34 L36 14 L44.5 34 L55 22 L55 49 Z" fill="url(#fcgold)"/>
<path d="M17 22 L27.5 34 L36 14 L44.5 34 L55 22" fill="none" stroke="#fff3cd" stroke-width=".9" opacity=".85"/>
<path d="M17 49 L17 22 L21 26 L21 49 Z" fill="#a97c22" opacity=".55"/>
<path d="M36 14 L40 26 L36 30 L32 26 Z" fill="#c99a2e" opacity=".5"/>
<rect x="16" y="47.6" width="40" height="7" rx="2.6" fill="url(#fcgold)"/>
<rect x="16" y="47.6" width="40" height="2.2" rx="1.1" fill="#fff3cd" opacity=".55"/>
<rect x="16" y="53" width="40" height="1.6" fill="#3a2708" opacity=".8"/>
<path d="M36 12 L34.6 15 L36 16.6 L37.4 15 Z" fill="#fff3cd"/>
<circle cx="36" cy="44.4" r="3.4" fill="#a8263c"/><circle cx="35" cy="43.2" r="1" fill="#ffd6de" opacity=".8"/>
<circle cx="24.6" cy="44" r="2.1" fill="#2f6fb8"/><circle cx="47.4" cy="44" r="2.1" fill="#2f6fb8"/>
<circle cx="30.4" cy="43.6" r="1.5" fill="#e8e6dd"/><circle cx="41.6" cy="43.6" r="1.5" fill="#e8e6dd"/>
<path d="M20 58 Q24 56 28 58 M44 58 Q48 56 52 58" stroke="#c9c4b6" stroke-width=".9" fill="none" opacity=".7"/>
<ellipse cx="36" cy="80" rx="18" ry="3" fill="#000" opacity=".5" filter="url(#fcsoft)"/>`);

// 隐身衣：浮空的暗斗篷，兜帽里只有更深的黑
const ART_CLOAK = svg('fk', { bg0: '#2a2440', bg1: '#0c0a16' }, `
<circle cx="36" cy="38" r="22" fill="#8f9cff" opacity=".08" filter="url(#fkglow)"/>
<path d="M36 8 Q22 14 19 33 Q16 52 11 78 L61 78 Q56 52 53 33 Q50 14 36 8 Z" fill="#151228"/>
<path d="M36 10 Q24 16 22 34 Q20 50 16 76 L30 76 Q27 48 32 30 Z" fill="#1b1734"/>
<path d="M36 10 Q48 16 50 34 Q52 50 56 76 L42 76 Q45 48 40 30 Z" fill="#221c40"/>
<path d="M36 12 Q28 20 28 34 L34 76 L38 76 L44 34 Q44 20 36 12 Z" fill="#0f0d1e" opacity=".85"/>
<path d="M31 30 Q36 26 41 30 Q41 40 36 44 Q31 40 31 30 Z" fill="#05040c"/>
<path d="M31 30 Q36 26 41 30" stroke="#5a5f9c" stroke-width=".8" fill="none" opacity=".6"/>
<circle cx="34.2" cy="33.4" r="1.1" fill="#aab4ff" opacity=".7"/>
<circle cx="37.8" cy="33.4" r="1.1" fill="#aab4ff" opacity=".7"/>
<path d="M36 8 Q22 14 19 33 Q16 52 11 78" fill="none" stroke="#6f78c8" stroke-width="1.1" opacity=".5"/>
<path d="M24 44 Q28 56 25 76 M48 44 Q44 56 47 76 M36 46 L36 76" stroke="#2b2450" stroke-width="1.2" fill="none" opacity=".9"/>
<path d="M11 78 Q24 72 36 78 Q48 72 61 78" fill="none" stroke="#4b52a0" stroke-width=".9" opacity=".45"/>
<path d="M6 66 Q14 60 20 68" stroke="#8f9cff" stroke-width="1.3" fill="none" opacity=".28" stroke-linecap="round"/>
<path d="M52 58 Q60 54 66 60" stroke="#8f9cff" stroke-width="1.3" fill="none" opacity=".22" stroke-linecap="round"/>
<path d="M9 76 Q36 68 63 76 L63 84 L9 84 Z" fill="#06050c" opacity=".85"/>`);
// 功能牌统一底板：深色皮革 + 黄铜蚀刻圈
const funcPlate = (p, inner) => `
<path d="M0 60 Q36 50 72 60 L72 84 L0 84 Z" fill="#070d0e" opacity=".8"/>
<circle cx="36" cy="38" r="25" fill="#0d1a1a"/>
<circle cx="36" cy="38" r="25" fill="none" stroke="url(#${p}gold)" stroke-width="1.3" opacity=".9"/>
<circle cx="36" cy="38" r="22.6" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".8"/>
<circle cx="36" cy="38" r="27.4" fill="none" stroke="url(#${p}gold)" stroke-width=".5" opacity=".55" stroke-dasharray="1.6 2.4"/>
${inner}`;

// 洞若观火：烛光下的一只眼
const ART_PEEK = svg('fx1', { bg0: '#1d2f2d', bg1: '#080f0f' }, funcPlate('fx1', `
<path d="M11 38 Q36 14 61 38 Q36 62 11 38 Z" fill="#dff3ea" opacity=".1"/>
<path d="M11 38 Q36 14 61 38 Q36 62 11 38 Z" fill="none" stroke="url(#fx1gold)" stroke-width="1.6"/>
<path d="M13.6 38 Q36 17.4 58.4 38 Q36 58.6 13.6 38 Z" fill="#e8ddd0"/>
<path d="M13.6 38 Q36 17.4 58.4 38 Q36 58.6 13.6 38 Z" fill="none" stroke="#8a7444" stroke-width=".6"/>
<path d="M16 36 Q24 26 34 24.4 M56 36 Q48 26 38 24.4" stroke="#c05a5a" stroke-width=".6" fill="none" opacity=".7"/>
<circle cx="36" cy="38" r="11.4" fill="#3d6b52"/>
<circle cx="36" cy="38" r="11.4" fill="none" stroke="#16321f" stroke-width="2.2"/>
<g stroke="#7fc79a" stroke-width=".7" opacity=".8" fill="none">
<path d="M36 27 L36 35 M36 41 L36 49 M25 38 L33 38 M39 38 L47 38 M28.4 30.4 L33.6 35.6 M38.4 35.6 L43.6 30.4 M28.4 45.6 L33.6 40.4 M38.4 40.4 L43.6 45.6"/>
</g>
<circle cx="36" cy="38" r="5.4" fill="#08110d"/>
<circle cx="34.2" cy="35.8" r="2.2" fill="#ffffff" opacity=".92"/>
<circle cx="39" cy="41.6" r="1" fill="#ffffff" opacity=".5"/>
<path d="M12 32 Q22 22 34 20.8 M60 32 Q50 22 38 20.8" stroke="#2a1a12" stroke-width="1.7" fill="none" stroke-linecap="round"/>
<path d="M13.6 38 Q36 17.4 58.4 38" fill="none" stroke="#0c0704" stroke-width=".7" opacity=".7"/>
<path d="M9 52 Q14 48 19 52" stroke="#7fc79a" stroke-width="1" fill="none" opacity=".45"/>
<path d="M53 52 Q58 48 63 52" stroke="#7fc79a" stroke-width="1" fill="none" opacity=".45"/>`));

// 重整：铁手套从牌堆里抽出一张人牌，背后是炼金圆阵
const ART_REGROUP = svg('fx2', { bg0: '#1b2c2a', bg1: '#080f0e' }, funcPlate('fx2', `
<circle cx="36" cy="37" r="20" fill="none" stroke="#7fc79a" stroke-width=".8" opacity=".45" stroke-dasharray="3 2.6"/>
<circle cx="36" cy="37" r="15" fill="none" stroke="#7fc79a" stroke-width=".6" opacity=".3"/>
<path d="M52 20 A21 20 0 1 0 57 50" fill="none" stroke="#9fe6c8" stroke-width="2.1" stroke-linecap="round"/>
<path d="M52 20 L45.6 18.4 L53 12.4 Z" fill="#9fe6c8"/>
<rect x="27" y="27" width="17" height="23" rx="2.2" fill="#e8ddd0" opacity=".92" transform="rotate(-8 35.5 38.5)"/>
<rect x="27" y="27" width="17" height="23" rx="2.2" fill="none" stroke="#8a7444" stroke-width=".7" transform="rotate(-8 35.5 38.5)"/>
<circle cx="35" cy="35.6" r="3.2" fill="#8a7444" opacity=".8" transform="rotate(-8 35.5 38.5)"/>
<path d="M29 45 Q35 40 42 45 Z" fill="#8a7444" opacity=".8" transform="rotate(-8 35.5 38.5)"/>
<path d="M25 20 Q36 14 47 20 L47 27 Q36 22 25 27 Z" fill="#1a2a28"/>
<path d="M26 21 Q36 15.6 46 21" stroke="#5a7a70" stroke-width="1" fill="none"/>
<path d="M31 24 L31 44 M35 23 L35 44 M39 23 L39 44" stroke="#2f4440" stroke-width="1.2" opacity=".8"/>
<path d="M26 44 Q36 48 46 44 L46 50 Q36 54 26 50 Z" fill="#22332f"/>
<path d="M26 33 L21 33 Q18.6 33 18.6 35.4 L18.6 38.6 Q18.6 41 21 41 L26 41 Z" fill="#2b3f3a"/>
<circle cx="22" cy="37" r="2.6" fill="#d8a83c" opacity=".85"/>
<path d="M16 66 Q26 60 36 66 Q46 60 56 66" stroke="#7fc79a" stroke-width="1.1" fill="none" opacity=".4"/>`));

// 颠倒是非：一面金一面黑的翻转硬币
const ART_FLIP = svg('fx3', { bg0: '#22303a', bg1: '#0a1014' }, funcPlate('fx3', `
<circle cx="36" cy="37" r="19" fill="#000" opacity=".5" filter="url(#fx3soft)"/>
<circle cx="36" cy="35" r="17.4" fill="url(#fx3gold)"/>
<circle cx="36" cy="35" r="17.4" fill="none" stroke="#3a2708" stroke-width="1"/>
<path d="M36 17.6 A17.4 17.4 0 0 1 36 52.4 A17.4 17.4 0 0 1 36 17.6 Z" fill="#0a0a0c"/>
<path d="M36 17.6 A17.4 17.4 0 0 1 36 52.4 L36 35 Z" fill="#101014"/>
<circle cx="36" cy="35" r="15.6" fill="none" stroke="#fff3cd" stroke-width=".6" opacity=".5"/>
<path d="M36 17.6 A17.4 17.4 0 0 1 36 52.4" fill="none" stroke="#d8a83c" stroke-width="1.6"/>
<circle cx="27.4" cy="30.4" r="2" fill="#3a2708"/><circle cx="27.4" cy="30.4" r="1" fill="#f6dd9a" opacity=".8"/>
<path d="M23.6 38.6 Q27.4 41.6 31.2 38.6" stroke="#3a2708" stroke-width="1.3" fill="none" stroke-linecap="round"/>
<circle cx="44.6" cy="30.4" r="2" fill="#050506"/><circle cx="44.6" cy="30.4" r=".9" fill="#c9403f"/>
<path d="M40.8 40.6 Q44.6 37.2 48.4 40.6" stroke="#8e1f2a" stroke-width="1.4" fill="none" stroke-linecap="round"/>
<path d="M30 22.4 Q36 18.6 42 22.4" stroke="#3a2708" stroke-width="1.2" fill="none" opacity=".8"/>
<path d="M30 48 Q36 51.4 42 48" stroke="#7a1520" stroke-width="1.2" fill="none" opacity=".8"/>
<path d="M14 62 Q24 54 36 62 Q48 54 58 62" fill="none" stroke="#ff8fa6" stroke-width="1.5" opacity=".7" stroke-linecap="round"/>
<path d="M14 62 L18.4 58.8 M58 62 L53.6 58.8" stroke="#ff8fa6" stroke-width="1.5" stroke-linecap="round" opacity=".7"/>
<path d="M20 24 Q26 18 34 20 M52 24 Q46 18 38 20" stroke="#fff3cd" stroke-width=".7" fill="none" opacity=".45"/>`));
// 铸剑为犁：砧上把剑打成犁，火星四溅
const ART_PLOUGH = svg('fx4', { bg0: '#33241a', bg1: '#0f0a07' }, funcPlate('fx4', `
<circle cx="36" cy="46" r="17" fill="#ff9a3c" opacity=".16" filter="url(#fx4glow)"/>
<path d="M28 52 Q33 53.4 38 52" stroke="#ffb35c" stroke-width="3" fill="none" stroke-linecap="round" opacity=".35" filter="url(#fx4glow)"/>
<rect x="19" y="52" width="34" height="6.4" rx="1.6" fill="#4a5058"/>
<rect x="19" y="52" width="34" height="2" rx="1" fill="#7b858f" opacity=".7"/>
<path d="M25 58.4 L23 70 L49 70 L47 58.4 Z" fill="#2f353c"/>
<path d="M27 16 L51 32 Q52.4 34 50 35.6 L45 39 Q43 40.4 41.6 38.6 L18 21.4 Z" fill="url(#fx4steel)"/>
<path d="M27 16 L51 32" stroke="#eaf2fa" stroke-width=".8" opacity=".7"/>
<path d="M18 21.4 L22.6 18.4 L24.4 20.8 L19.8 23.8 Z" fill="#8a6a2a"/>
<ellipse cx="31" cy="34" rx="9" ry="6" fill="none" stroke="#ffb35c" stroke-width="1.2" opacity=".45"/>
<path d="M12 74 Q34 68 56 74" stroke="#7a6b4a" stroke-width="1.2" fill="none" opacity=".5"/>
<g fill="#ffd27a" opacity=".9">
<circle cx="22" cy="24" r="1"/><circle cx="46" cy="20" r=".8"/><circle cx="52" cy="44" r="1.1"/>
<circle cx="17" cy="42" r=".7"/><circle cx="30" cy="50" r=".9"/><circle cx="44" cy="56" r=".7"/>
</g>
<g stroke="#ff8f3c" stroke-width="1.1" stroke-linecap="round" opacity=".8">
<path d="M22 24 L19 19 M46 20 L48 14 M52 44 L58 44 M17 42 L12 42"/>
</g>
<path d="M12 66 Q22 60 30 66 Q22 70 12 66 Z" fill="#7fc79a" opacity=".7"/>`));

// 推心置腹：两只手交换火漆封缄的卷轴
const ART_EXCHANGE = svg('fx5', { bg0: '#2b2233', bg1: '#0b0810' }, funcPlate('fx5', `
<rect x="25.6" y="24" width="20.8" height="27" rx="2.4" fill="#d6c49b"/>
<rect x="25.6" y="24" width="20.8" height="27" rx="2.4" fill="none" stroke="#8a7444" stroke-width=".7"/>
<rect x="25.6" y="24" width="20.8" height="4.6" rx="2.3" fill="#c0ac7e"/>
<rect x="25.6" y="46.4" width="20.8" height="4.6" rx="2.3" fill="#c0ac7e"/>
<path d="M30 34 L42 34 M30 38.6 L42 38.6" stroke="#8a7444" stroke-width=".8" opacity=".7"/>
<circle cx="36" cy="42.6" r="4.1" fill="#8e1f2a"/>
<path d="M36 45.6 C32.6 43 31.4 40.8 33 39.4 C34.2 38.4 35.4 39.4 36 40.2 C36.6 39.4 37.8 38.4 39 39.4 C40.6 40.8 39.4 43 36 45.6 Z" fill="#e8b9be" opacity=".7"/>
<path d="M6 58 Q16 48 25 53 Q31 56 30 60 Q27 63 22 61 Q14 58 8 63 Z" fill="#c08a5c"/>
<path d="M6 58 Q16 48 25 53" stroke="#e8bd8f" stroke-width=".8" fill="none" opacity=".7"/>
<path d="M66 62 Q56 72 47 67 Q41 64 42 60 Q45 57 50 59 Q58 62 64 57 Z" fill="#a8764f"/>
<path d="M66 62 Q56 72 47 67" stroke="#8a5c3c" stroke-width=".8" fill="none" opacity=".7"/>
<path d="M42 60 L30 60 M30 60 L38 56 M30 60 L38 64" stroke="#7fc79a" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".85"/>
<path d="M8 68 Q20 62 32 68 Q20 72 8 68 Z" fill="#7fc79a" opacity=".55"/>
<path d="M64 52 Q54 46 44 52" stroke="#7fc79a" stroke-width="1.1" fill="none" opacity=".4"/>`));

// 沉默：唇上封印的蜡印与锁链
const ART_SILENCE = svg('fx6', { bg0: '#1d2733', bg1: '#080c11' }, funcPlate('fx6', `
<path d="M23 20 Q36 14 49 20 Q53 32 50 44 Q47 56 36 58 Q25 56 22 44 Q19 32 23 20 Z" fill="#6b452a"/>
<path d="M36 14 Q49 14 50 30 Q50 42 45 50 Q48 38 46 28 Q43 18 36 17 Z" fill="#4a2f1c" opacity=".7"/>
<path d="M23 30 Q27 26 31 30 M41 30 Q45 26 49 30" stroke="#3a2417" stroke-width="1.3" fill="none" stroke-linecap="round"/>
<circle cx="27.4" cy="33" r="1.5" fill="#20140c"/><circle cx="44.6" cy="33" r="1.5" fill="#20140c"/>
<path d="M33 33 L33 40 Q34.6 40.6 33.6 41.4" stroke="#4a2f1c" stroke-width="1" fill="none" stroke-linecap="round"/>
<rect x="26" y="43.4" width="20" height="8" rx="2.2" fill="#5a3418"/>
<rect x="26" y="43.4" width="20" height="2.6" rx="1.3" fill="#7d4a22" opacity=".8"/>
<circle cx="36" cy="47.4" r="3.6" fill="#8e1f2a"/>
<circle cx="36" cy="47.4" r="3.6" fill="none" stroke="#c9747c" stroke-width=".7"/>
<path d="M34.4 46.4 L37.6 48.4 M37.6 46.4 L34.4 48.4" stroke="#f0c6ca" stroke-width=".8" stroke-linecap="round"/>
<path d="M26 51.4 Q36 55 46 51.4" stroke="#3a2417" stroke-width="1" fill="none" opacity=".8"/>
<g stroke="#8d99a6" stroke-width="1.5" fill="none" opacity=".85">
<path d="M12 24 Q17 28 14 33 Q11 37 16 40"/>
<path d="M60 24 Q55 28 58 33 Q61 37 56 40"/>
</g>
<g fill="none" stroke="#6d7883" stroke-width="1.1">
<circle cx="13.4" cy="26" r="2.1"/><circle cx="15" cy="37.4" r="2.1"/>
<circle cx="58.6" cy="26" r="2.1"/><circle cx="57" cy="37.4" r="2.1"/>
</g>
<path d="M18 62 Q36 56 54 62" stroke="#ff8fa6" stroke-width="1.4" fill="none" opacity=".55"/>`));

// 止戈：兵器架上交叉放下的剑与战斧，橄榄枝
const ART_TRUCE = svg('fx7', { bg0: '#26302e', bg1: '#0a0f0e' }, funcPlate('fx7', `
<circle cx="36" cy="34" r="18" fill="#dff3ea" opacity=".1" filter="url(#fx7glow)"/>
<path d="M12 62 L60 22" stroke="url(#fx7steel)" stroke-width="3.6" stroke-linecap="round"/>
<path d="M12 62 L60 22" stroke="#ffffff" stroke-width=".7" opacity=".5" stroke-linecap="round"/>
<path d="M12 62 L17.6 57.4" stroke="#8a6a2a" stroke-width="4" stroke-linecap="round"/>
<path d="M60 62 L12 22" stroke="#6b4a24" stroke-width="3.8" stroke-linecap="round"/>
<path d="M42.6 18.6 Q52 22.6 56.6 31 Q49 33.4 43.4 27.6 Q41 22.6 42.6 18.6 Z" fill="#9daab8"/>
<path d="M43.6 19.6 Q50.4 23.6 54.4 30" stroke="#eaf2fa" stroke-width=".8" fill="none" opacity=".7"/>
<path d="M14.4 60 L20 64.4" stroke="#2a1a0c" stroke-width="4.6" stroke-linecap="round"/>
<path d="M22 46 Q30 40 38 46 Q30 50 22 46 Z" fill="#7fc79a" opacity=".8"/>
<path d="M34 52 Q42 46 50 52 Q42 56 34 52 Z" fill="#7fc79a" opacity=".65"/>
<path d="M20 30 Q32 22 46 26" stroke="#9fe6c8" stroke-width="1.2" fill="none" opacity=".5"/>
<path d="M10 70 Q26 64 42 70 Q58 76 66 70" stroke="#7fc79a" stroke-width="1.3" fill="none" opacity=".5"/>
<circle cx="24" cy="27" r="1" fill="#dff3ea" opacity=".8"/><circle cx="52" cy="36" r=".8" fill="#dff3ea" opacity=".6"/>`));
// 牌背：深色皮革 + 鎏金纹章 + 铆钉，用于对手手牌与牌堆
const BACK_ART = `<svg class="art" viewBox="0 0 72 84" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
<defs>
<linearGradient id="bkLeather" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#2a2136"/><stop offset="50%" stop-color="#1a1424"/><stop offset="100%" stop-color="#0d0a14"/>
</linearGradient>
<linearGradient id="bkGold" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#f8e6ad"/><stop offset="40%" stop-color="#c9a23a"/><stop offset="100%" stop-color="#4e3510"/>
</linearGradient>
<filter id="bkGrain" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/>
</filter>
<filter id="bkSoft"><feGaussianBlur stdDeviation="2.4"/></filter>
</defs>
<rect width="72" height="84" rx="6" fill="url(#bkLeather)"/>
<path d="M4 4 L68 80 M68 4 L4 80" stroke="#000" stroke-opacity=".35" stroke-width="7"/>
<path d="M4 4 L68 80 M68 4 L4 80" stroke="#4a3f66" stroke-opacity=".35" stroke-width="1"/>
<circle cx="36" cy="42" r="24" fill="#000" opacity=".4" filter="url(#bkSoft)"/>
<circle cx="36" cy="41" r="19.4" fill="none" stroke="url(#bkGold)" stroke-width="1.2" opacity=".9"/>
<circle cx="36" cy="41" r="16.6" fill="none" stroke="url(#bkGold)" stroke-width=".6" opacity=".6" stroke-dasharray="1.8 2.6"/>
<path d="M24 46 L24 32 L31 39 L36 26 L41 39 L48 32 L48 46 Z" fill="url(#bkGold)"/>
<rect x="23.4" y="45.4" width="25.2" height="4.4" rx="1.6" fill="#8a6420"/>
<circle cx="36" cy="42" r="2.1" fill="#a8263c"/>
<circle cx="28.6" cy="42.4" r="1.2" fill="#e8e6dd" opacity=".9"/>
<circle cx="43.4" cy="42.4" r="1.2" fill="#e8e6dd" opacity=".9"/>
<g fill="#c9a23a" opacity=".85">
<circle cx="8" cy="8" r="1.3"/><circle cx="64" cy="8" r="1.3"/><circle cx="8" cy="76" r="1.3"/><circle cx="64" cy="76" r="1.3"/>
</g>
<rect x="1.05" y="1.05" width="69.9" height="81.9" rx="5.2" fill="none" stroke="url(#bkGold)" stroke-width="1.6"/>
<rect x="1" y="1" width="70" height="82" rx="5" filter="url(#bkGrain)" opacity=".16" style="mix-blend-mode:overlay"/>
</svg>`;

const FACE_TABLE = {
  '人(善)': { cls: 'good', name: '人（善）', sub: '行善之人', corner: '善', art: ART_GOOD },
  '人(恶)': { cls: 'evil', name: '人（恶）', sub: '背后藏刀', corner: '恶', art: ART_EVIL },
  武器: { cls: 'weapon', name: '武器', sub: '骑士之刃', corner: '器', art: ART_WEAPON },
  皇冠: { cls: 'crown', name: '皇冠', sub: '王权加身', corner: '冠', art: ART_CROWN },
  隐身衣: { cls: 'cloak', name: '隐身衣', sub: '窃国之贼', corner: '隐', art: ART_CLOAK },
  洞若观火: { cls: 'func', name: '洞若观火', sub: '窥探一张手牌', corner: '功', art: ART_PEEK },
  重整: { cls: 'func', name: '重整', sub: '抽一张人牌', corner: '功', art: ART_REGROUP },
  颠倒是非: { cls: 'func', name: '颠倒是非', sub: '善恶化', corner: '功', art: ART_FLIP },
  铸剑为犁: { cls: 'func', name: '铸剑为犁', sub: '销毁一张武器', corner: '功', art: ART_PLOUGH },
  推心置腹: { cls: 'func', name: '推心置腹', sub: '交换手牌', corner: '功', art: ART_EXCHANGE },
  沉默: { cls: 'func', name: '沉默', sub: '封住功能牌', corner: '功', art: ART_SILENCE },
  止戈: { cls: 'func', name: '止戈', sub: '停战罢兵', corner: '功', art: ART_TRUCE },
};

const BY_NAME = Object.fromEntries(Object.values(FACE_TABLE).map((f) => [f.name, f]));

const DESC = {
  '人(善)': '唯一能用来出战的牌。单人出战＝普通人；配武器＝骑士；配皇冠＝国王；配隐身衣＝贼。',
  '人(恶)': '唯一能用来出战的牌。单人出战＝普通人；配武器＝匪徒；配皇冠＝国王；配隐身衣＝贼。',
  武器: '道具。和人牌一起出战 → 善人＝骑士、恶人＝匪徒（骑士克制匪徒）。也可能被对手的贼夺走。',
  皇冠: '道具。和人牌一起出战 → 国王（克制骑士）。每名玩家手牌最多只能有 1 张皇冠。',
  隐身衣: '道具。和人牌一起出战 → 贼：先弃掉隐身衣，再夺走对手出战组合里的武器。贼没有克制关系，对谁都是平局。',
  洞若观火: '功能牌（全局仅 1 张）。偷看对手随机 1 张手牌，只有你能看到，对手不会收到任何提示。',
  重整: '功能牌（全局仅 1 张）。从主牌堆里随机抽 1 张人牌加入手牌；牌堆里已经没有人牌则无效果。',
  颠倒是非: '功能牌（全局仅 1 张）。随机把对手手牌里 1 张人牌在善↔恶之间翻面。',
  铸剑为犁: '功能牌（全局仅 1 张）。随机销毁对手手牌里的 1 张武器；如果对手只剩这一张武器，会直接判负。',
  推心置腹: '功能牌（全局仅 1 张）。你自选 1 张手牌，与对手随机 1 张手牌互换归属（功能牌不可被交换）。',
  沉默: '功能牌（全局仅 1 张）。让对手的下一个回合不能打出任何功能牌。',
  止戈: '功能牌（全局仅 1 张）。跳过本回合的背水一战、对抗宣告与战斗结算。主牌堆已空时打出它可直接停战结算，按手牌数比大小——手牌多的一方赢。',
};
const DESC_BACK = '对手的手牌（背面）。数量默认不公开：只有当对手被检视、或对局结束时才会亮出。';

export function faceOf(card) {
  if (!card) return FACE_TABLE['人(善)'];
  if (card.kind === 'person') return FACE_TABLE[card.align === '善' ? '人(善)' : '人(恶)'];
  return FACE_TABLE[card.name] ?? FACE_TABLE['洞若观火'];
}

export function labelFace(labelText) {
  return FACE_TABLE[labelText] ?? BY_NAME[labelText] ?? FACE_TABLE['洞若观火'];
}

export function cardDesc(face) {
  if (!face) return DESC_BACK;
  return DESC[face.name.replace('（善）', '(善)').replace('（恶）', '(恶)')] ?? DESC_BACK;
}

export const secretDesc = () => DESC_BACK;

export function cardHtml(face, extra = '', data = '') {
  return `<div class="card ${face.cls} ${extra}" ${data} data-face="${face.name}">
<div class="cardart">${face.art}</div>
<div class="plate"><b>${face.name}</b>${face.sub ? `<i>${face.sub}</i>` : ''}</div>
<span class="corner">${face.corner}</span></div>`;
}

export const backHtml = (extra = '') =>
  `<div class="card back ${extra}" data-secret="1"><div class="cardart">${BACK_ART}</div></div>`;

// 悬停放大用：不带 data-card（避免触发点击逻辑），只用于展示
export function zoomHtml(face, extra = '') {
  return `<div class="card big ${face.cls} ${extra}">
<div class="cardart">${face.art}</div>
<div class="plate"><b>${face.name}</b>${face.sub ? `<i>${face.sub}</i>` : ''}</div>
<span class="corner">${face.corner}</span></div>`;
}