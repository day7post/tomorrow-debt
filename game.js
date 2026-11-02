'use strict';
/* 《明日债 · Tomorrow's Debt》 v0.4.0「解契」
题材级转型：恐怖悬疑点击探索解谜。第一章《老居民楼》完整可通关。
世界观见 LORE.md（时契行三条铁律）。多人合作：房主权威状态同步（最多 4 人），
难度随人数上升：契文分持、分闸同拉、点烛记序变长。封印保留为封门画符仪式。 */

/* ---------------- 工具与音效 ---------------- */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let muted = false, audioCtx = null;
function beep(freq, dur, type, vol) {
if (muted) return;
try {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const o = audioCtx.createOscillator(), g = audioCtx.createGain();
o.type = type || 'sine'; o.frequency.value = freq;
g.gain.value = vol || 0.035;
g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
o.connect(g); g.connect(audioCtx.destination);
o.start(); o.stop(audioCtx.currentTime + dur);
} catch (e) {}
}
function buzz() { beep(110, 0.18, 'sawtooth', 0.05);}
function chime(n) { beep(520 + (n || 0) * 70, 0.12, 'sine', 0.045);}

/* ---------------- 道具 ---------------- */
const ITEMS = {
postcard: { name: '旧明信片', desc: '照片里是这栋楼刚交付时的样子。背面钢笔字：「1998.6.12，搬进新家，302。从此落地生根。」'},
bill: { name: '电费催缴单', desc: '户号 302，户名周守义。欠费栏空着——三年了，没人再用电，表却还在走。'},
battery: { name: '电池', desc: '两节五号电池，还有电。'},
smallkey: { name: '小钥匙', desc: '黄铜小钥匙，匙柄刻着一个「床」字。'},
page1: { name: '契文 · 上半页', page: true, text: '\n立契人：周守义。今向时契行借取阳寿三年，\n自二〇一九年七月十九日起，至二〇二二年七月十九日止。\n所借之命，非行里之命，乃立契人未来之命。\n到期之日，由送契人亲手送达此契，账目两清。'},
page2: { name: '契文 · 下半页', page: true, text: '\n若契逾期未达，未来之契主自会登门对账，\n其形貌、手段，皆如契主本人。\n立契人按印：周守义。见证：送契人 陆——（后一个字被水渍洇开了）'},
contract: { name: '完整的《明日契》', desc: '两半页契文已经合上。纸是凉的，像刚从很远的地方回来。'},
medical: { name: '病历本', desc: '县医院。入院日期：2019 年 7 月 19 日。床号：3 床。诊断一栏被折角盖住了，只露出一行小字：「患者要求出院，说，要回家等一个人。」'},
letter: { name: '绝笔信', desc: '「守义绝笔：借这三年，我看着孙女落地，看着儿子成家，够本了。送契的小师傅若你看到这封信，替我谢谢你师父——那晚雨大，他没走到，不怪他。契放我遗像前就行，剩下的账，让未来的我自己来收。」'},
ticket: { name: '长途车票', desc: '城郊汽车站 → 本市，明早 06:40 发车，座位 12。还没到日子——这张票，是给明天准备的。'}
};

/* ---------------- 世界状态（房主持有，广播同步） ---------------- */
let G = null;
let myView = 'black'; // 本地当前视图（各端独立导航）
let mySel = null; // 本地选中的道具
let dlgQueue = [], dlgChoices = null, dlgOnDone = null;
let pendingLines = []; // act 执行期间收集的台词，执行后分发
let candle = null; // {seq:[], input:[], phase:'show'|'input', idx}
let kpCtx = null, clockVal = { h: 3, m: 0}, sealCtx = null;

function newGame(playerCount) {
return {
started: true, ended: false, t0: Date.now(), time: 0,
players: playerCount, flags: {}, inv: [], debt: 0,
borrows: {}, solved: {}, pages: {}, switches: {}, hintUsed: {},
candleSeqLen: 3 + playerCount
};
}
function F(k) { return!!(G && G.flags[k]);}
function setF(k, v) { G.flags[k] = v === undefined? true: v;}
function has(item) { return G.inv.includes(item);}
function give(item) { if (!has(item)) G.inv.push(item);}
function myId() { return window.TDNet? TDNet.myId: 0;}
function isHostSide() { return!window.TDNet || TDNet.role!== 'guest';}

/* ---------------- 台词 ---------------- */
function say(who, text) { pendingLines.push({ who, text});}
function flushSay(actorId) {
const lines = pendingLines; pendingLines = [];
if (!lines.length) return;
if (isHostSide()) {
showLines(lines);
if (window.TDNet && TDNet.role === 'host') TDNet.broadcast({ t: 'lines', lines});
}
}
function showLines(lines) {
dlgQueue = dlgQueue.concat(lines);
pumpDialog();
}
function pumpDialog() {
const box = $('dialog');
if (!dlgQueue.length) { show(box, false); dlgOnDone && (dlgOnDone(), dlgOnDone = null); return;}
show(box, true);
const cur = dlgQueue[0];
$('dlg-name').textContent = cur.who || '';
$('dlg-text').textContent = cur.text;
$('dlg-next').style.visibility = dlgChoices? 'hidden': 'visible';
renderChoices();
}
function renderChoices() {
const box = $('dlg-choices'); box.innerHTML = '';
if (!dlgChoices || !dlgChoices.list) return;
dlgChoices.list.forEach(c => {
const b = document.createElement('button');
b.className = 'dlg-choice' + (c.borrow? ' borrow': '');
b.textContent = c.label;
b.onclick = e => { e.stopPropagation(); handleChoice(c); };
box.appendChild(b);
});
}
$('dialog').addEventListener('click', () => {
if (dlgChoices) return;
dlgQueue.shift();
beep(660, 0.03, 'sine', 0.015);
pumpDialog();
});

/* ---------------- 提示 ---------------- */
const STAGES = [
{ id: 'door', hint: '先别敲门。这层楼里，还有别的东西在等你看。', strong: '明信片背面写着搬家的日子：1998 年 6 月 12 日。门锁密码就是 0612。'},
{ id: 'power', hint: '黑着进一间死人的屋子，不合规矩。电，是一间屋子的命。', strong: '分闸在楼道电表箱、厨房墙、卫浴墙：人数几人就几处，多人时要在 4.5 秒内先后合上，分头去拉。'},
{ id: 'tv', hint: '遥控器是死的。能让它活过来的东西，不在电视跟前。', strong: '供桌抽屉里有电池和小钥匙。电池装上后看录像，记住他说的那个时辰：3 点 15 分。'},
{ id: 'clock', hint: '他留在录像里的那句话，不是怀旧。', strong: '把挂钟调到 03:15，再上弦。钟座的暗格会开。'},
{ id: 'drawer',hint: '锁着的东西，钥匙多半也在这个家里。', strong: '小钥匙开床头柜抽屉，里面是病历本——入院日期 7 月 19 日，就是保险箱密码 0719。'},
{ id: 'safe', hint: '密码是个日子。哪一天，得去纸上找。', strong: '保险箱密码 0719（入院日期）。里面是契文的下半页。'},
{ id: 'contract', hint: '两半页都到手了。剩下的事，遗像前办。', strong: '点道具栏里的半页契文合上契，再点供桌遗像，把完整的契放上去。'},
{ id: 'candles', hint: '烛，要按规矩点。规矩会先演给你看。', strong: '顺序只演一遍。可以重看：再点一次遗像，会重新演。记不住，就分工——一人记一半。'},
{ id: 'ritual', hint: '它不怕你。它只认印。', strong: '圈要闭合、要够大、要圈住契纹。画之前先借命稳印也行——但那是你的命。'}
];
function currentStage() {
if (!G ||!G.started) return null;
if (G.ended) return null;
if (!F('doorOpen')) return 'door';
if (!F('power') &&!F('borrowPower')) return 'power';
if (!F('videoSeen')) return 'tv';
if (!F('clockSolved')) return 'clock';
if (!F('medicalSeen')) return 'drawer';
if (!F('safeOpen')) return 'safe';
if (!F('contractPlaced')) return 'contract';
if (!F('candlesDone')) return 'candles';
return 'ritual';
}
$('btn-hint').addEventListener('click', () => {
const st = currentStage(); if (!st) return;
const def = STAGES.find(s => s.id === st);
const used = G.hintUsed[st] || 0;
if (used === 0) {
G.hintUsed[st] = 1;
showLines([{ who: '契纹微光', text: def.hint}]);
syncSoon();
} else if (used === 1) {
dlgChoices = { for: myId(), list: [
{ label: '再想想', local: 'noop' },
{ label: '借命换强提示（+1 命债）', borrow: true, act: { k: 'borrowHint', stage: st } }
] };
showLines([{ who: '契纹微光', text: '微光只够照到这里。再往前，是要付账的。'}]);
renderChoices();
} else {
showLines([{ who: '契纹', text: def.strong}]);
}
});

/* ---------------- 笔记本 ---------------- */
function notebookText() {
const L = [];
L.push('时契行三条铁律');
L.push('一、契向未来借：你借的命，是未来的你在替你过。债主，永远是未来的你自己。');
L.push('二、契须亲手送达：隔手无效。逾期未达的契，会自己找路。');
L.push('三、见契纹者，皆欠债人：普通人看不见契纹。');
L.push('');
L.push('契主周守义，302 户，退休钳工。三年前向行里借命三年，契逾期未达，人已过世。今夜把契送到，账目两清。');
if (F('postcardSeen')) L.push('· 明信片：1998.6.12 搬进 302。');
if (F('videoSeen')) L.push('· 录像里他说：钟停在 3:15，那是他从医院回来的时辰，柜子认这个时辰。');
if (F('medicalSeen')) L.push('· 病历：2019 年 7 月 19 日入院，3 床。');
if (F('letterSeen')) L.push('· 绝笔信：他等的人都等到了。师父那晚雨大没走到，他说不怪。');
L.push('');
L.push('');
['page1', 'page2'].forEach(pid => {
if (!has(pid) &&!(pid === 'page1' && has('contract')) &&!(pid === 'page2' && has('contract'))) { L.push('· ' + (pid === 'page1'? '上半页': '下半页') + '：尚未找到。'); return;}
const owner = G.pages[pid];
if (G.players > 1 && owner!== undefined && owner!== myId()) {
L.push('· ' + (pid === 'page1'? '上半页': '下半页') + '：在 ' + owner + ' 号同行者手里——让他念给你听。');
} else {
L.push(ITEMS[pid].text);
}
L.push('');
});
L.push('已借 ' + G.debt + ' 笔。借得越多，终局的账越重。');
return L.join('\n');
}
$('btn-note').addEventListener('click', () => { $('note-body').textContent = notebookText(); show($('notebook'), true);});
$('btn-note-close').addEventListener('click', () => show($('notebook'), false));

/* ---------------- 通用 UI ---------------- */
function show(el, on) { el.classList.toggle('hidden',!on);}
function toast(txt, ms) {
const t = $('toast'); t.textContent = txt; show(t, true);
setTimeout(() => show(t, false), ms || 2100);
}
function renderTop() {
if (!G) return;
$('debt-n').textContent = G.debt;
$('crew-chip').textContent = G.players + ' 人' + (G.players > 1? ' · 难度↑': '');
}
function renderInv() {
const box = $('inv-items'); box.innerHTML = '';
(G? G.inv: []).forEach(id => {
const b = document.createElement('button');
b.className = 'inv-item' + (mySel === id? ' sel': '');
const owner = ITEMS[id].page && G.players > 1? G.pages[id]: undefined;
b.innerHTML = ITEMS[id].name + (owner!== undefined && owner!== myId()? '<small>在 ' + owner + ' 号手里</small>': '<small>道具</small>');
b.onclick = () => {
if (mySel === id) { examine(id); mySel = null;}
else mySel = id;
renderInv();
};
box.appendChild(b);
});
}
function examine(id) {
const it = ITEMS[id]; if (!it) return;
if (it.page) {
const owner = G.pages[id];
if (G.players > 1 && owner!== undefined && owner!== myId()) {
showLines([{ who: '契文', text: '这一页在 ' + owner + ' 号同行者手里。你只能看见纸背的纹路——内容，让他念给你听。'}]);
return;
}
if (id === 'page1') setF('page1Seen');
if (id === 'page2') setF('page2Seen');
showLines([{ who: '契文', text: it.text}]);
if (has('page1') && has('page2') && !has('contract')) doAct({ k: 'combine' });
else syncSoon();
return;
}
if (id === 'postcard') { setF('postcardSeen'); syncSoon();}
if (id === 'medical') { setF('medicalSeen'); syncSoon();}
if (id === 'letter') { setF('letterSeen'); syncSoon();}
showLines([{ who: it.name, text: it.desc}]);
}
function maybeCombine() { /* 已并入房主 actImpl 的 combine 动作（跨端一致） */ }

/* ---------------- 人物形象 ---------------- */
function porterFigure(x, y, s) {
  /* 送契人：背影，深灰长褂，一手提灯，一手抱着白契 */
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="118" rx="27" ry="6" fill="rgba(0,0,0,0.38)"/>
    <path d="M-13 118 L-9.5 36 Q0 27 9.5 36 L13 118 Q0 124.5 -13 118Z" fill="#252b38"/>
    <path d="M-9.5 36 Q0 27 9.5 36 L10.5 62 L-10.5 62Z" fill="#303847"/>
    <line x1="0" y1="62" x2="0" y2="116" stroke="#171b24" stroke-width="2"/>
    <circle cx="0" cy="15" r="11.5" fill="#15171e"/>
    <path d="M-12 13 a12 10 0 0 1 24 0 l0 -4.5 -24 0Z" fill="#0c0d12"/>
    <rect x="-19" y="50" width="13" height="17.5" rx="1.5" fill="#eae3d0" transform="rotate(-9 -12 58)"/>
    <rect x="-19" y="50" width="13" height="17.5" rx="1.5" fill="none" stroke="#b3a67f" stroke-width="1" transform="rotate(-9 -12 58)"/>
    <line x1="12" y1="44" x2="23" y2="64" stroke="#454c5e" stroke-width="3"/>
    <rect x="17.5" y="64" width="12" height="16" rx="3" fill="#5d4a26"/>
    <rect x="20" y="67" width="7" height="10" rx="2" fill="#ffca7a"/>
  </g>`;
}
function shadowFigure(cx) {
  /* 未来的周守义：黑影，红眼，只在点烛之后站在供桌后面 */
  return `<g opacity="0.85">
    <ellipse cx="${cx}" cy="332" rx="31" ry="7" fill="rgba(0,0,0,0.45)"/>
    <path d="M${cx - 16} 332 L${cx - 12} 214 Q${cx} 203 ${cx + 12} 214 L${cx + 16} 332Z" fill="#06060b"/>
    <circle cx="${cx}" cy="194" r="13.5" fill="#06060b"/>
    <circle cx="${cx - 4.5}" cy="194" r="2.3" fill="#ff5d6e"/>
    <circle cx="${cx + 4.5}" cy="194" r="2.3" fill="#ff5d6e"/>
  </g>`;
}

/* ---------------- 场景美术（写实向矢量场景） ---------------- */
function corridorSvg() {
  const doorOpen = F('doorOpen');
  return `<svg viewBox="0 0 900 620" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="cw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3242"/><stop offset="1" stop-color="#171b28"/></linearGradient>
  <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f4d"/><stop offset="1" stop-color="#101219"/></linearGradient></defs>
  <rect width="900" height="430" fill="url(#cw)"/><rect y="430" width="900" height="190" fill="url(#cf)"/>
  <polygon points="0,430 900,430 900,470 0,470" fill="#0c0e14"/>
  ${[0,1,2,3,4,5].map(i => `<line x1="${60 + i * 150}" y1="470" x2="${30 + i * 150}" y2="620" stroke="#232733" stroke-width="3"/>`).join('')}
  <rect x="392" y="8" width="116" height="10" rx="4" fill="#11131c"/>
  <line x1="450" y1="18" x2="450" y2="58" stroke="#0d0f16" stroke-width="4"/>
  <ellipse cx="450" cy="76" rx="26" ry="17" fill="#ffd98a" opacity="0.9"/><ellipse cx="450" cy="120" rx="120" ry="46" fill="#ffdf9e" opacity="0.10"/>
  <!-- 左：楼梯口 -->
  <rect x="18" y="120" width="150" height="310" fill="#1c2130"/><rect x="18" y="120" width="150" height="14" fill="#262c3e"/>
  ${[0,1,2,3,4].map(i => `<rect x="${26 + i * 4}" y="${330 - i * 42}" width="${140 - i * 8}" height="12" fill="#313849"/>`).join('')}
  <text x="93" y="105" font-size="17" fill="#8b93a7" text-anchor="middle">3 层</text>
  <!-- 左下：信箱墙 -->
  <rect x="30" y="452" width="212" height="118" rx="6" fill="#39404f"/>
  ${[0,1,2,3,4,5,6,7].map(i => `<rect x="${42 + (i % 4) * 50}" y="${464 + Math.floor(i / 4) * 52}" width="42" height="44" rx="3" fill="#4a5265" stroke="#232833" stroke-width="2"/><circle cx="${63 + (i % 4) * 50}" cy="486" r="3.4" fill="#22262f"/>`).join('')}

  <!-- 302 门 -->
  <rect x="520" y="96" width="212" height="352" rx="4" fill="#10131d"/>
  <rect x="532" y="108" width="188" height="328" rx="3" fill="${doorOpen ? '#06070c' : '#4a3423'}"/>
  ${doorOpen ? '' : `<rect x="540" y="116" width="172" height="312" fill="none" stroke="#2e1f14" stroke-width="5"/>
  <rect x="548" y="128" width="14" height="120" fill="#7d1f24"/><text x="555" y="146" font-size="12" fill="#e8d9a0" text-anchor="middle" writing-mode="tb">千门万户</text>
  <rect x="690" y="128" width="14" height="120" fill="#7d1f24"/><text x="697" y="146" font-size="12" fill="#e8d9a0" text-anchor="middle" writing-mode="tb">曈曈日</text>
  <rect x="606" y="112" width="42" height="15" fill="#7d1f24"/><text x="627" y="124" font-size="11.5" fill="#e8d9a0" text-anchor="middle">302</text>
  <circle cx="700" cy="286" r="8" fill="#c9ccd6"/><rect x="672" y="252" width="34" height="46" rx="4" fill="#20242f" stroke="#3c4356" stroke-width="2"/><circle cx="689" cy="268" r="4" fill="#ffd76e"/>`}
  <!-- 右：电表箱与通知 -->
  <rect x="768" y="150" width="104" height="150" rx="5" fill="#2f3644" stroke="#454e61" stroke-width="2"/>
  <rect x="780" y="164" width="80" height="54" rx="3" fill="#171c28"/><circle cx="820" cy="191" r="17" fill="#232b3c" stroke="#4d5871" stroke-width="2"/>
  <rect x="772" y="330" width="96" height="86" fill="#d8d3c3" opacity="0.92"/>
  <text x="820" y="354" font-size="13" fill="#333" text-anchor="middle" font-weight="bold">物业通知</text>
  <text x="820" y="376" font-size="10.5" fill="#444" text-anchor="middle">本楼 1998 年交付</text>
  <text x="820" y="394" font-size="10.5" fill="#444" text-anchor="middle">老楼改造 住户配合</text>
  ${porterFigure(315, 338, 2.2)}
  </svg>`;
}

function livingSvg() {
  const dark = !F('power') && !F('borrowPower');
  const tv = F('tvOn') ? (F('videoSeen') ? 'video' : 'static') : 'off';
  const agg = F('contractPlaced');
  const cd = G && G.candle;
  const litNow = !cd ? -1 : cd.phase === 'show' ? (cd.idx > 0 ? cd.seq[cd.idx - 1] : -1) : (cd.input.length ? cd.input[cd.input.length - 1] : -1);
  const candleBase = i => {
    const lit = i === litNow;
    const ever = F('candlesDone');
    return `<g>
      <rect x="${352 + i * 52}" y="238" width="10" height="34" rx="2" fill="#e8e2d2"/>
      ${(lit || ever) ? `<ellipse cx="${357 + i * 52}" cy="228" rx="5.5" ry="10" fill="#ffb347"/><ellipse cx="${357 + i * 52}" cy="230" rx="2.4" ry="5" fill="#ffe9a8"/>` : `<line x1="${357 + i * 52}" y1="238" x2="${357 + i * 52}" y2="230" stroke="#555" stroke-width="2"/>`}
    </g>`;
  };
  return `<svg viewBox="0 0 900 620" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="lw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d3a35"/><stop offset="1" stop-color="#232019"/></linearGradient>
  <linearGradient id="lfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c4238"/><stop offset="1" stop-color="#191512"/></linearGradient></defs>
  <rect width="900" height="440" fill="url(#lw)"/><rect y="440" width="900" height="180" fill="url(#lfl)"/>
  ${[0,1,2,3,4,5,6].map(i => `<line x1="${i * 150}" y1="440" x2="${i * 150 - 40}" y2="620" stroke="#0f0d0a" stroke-width="3"/>`).join('')}
  ${F('candlesDone') && !(G && G.ended) ? shadowFigure(338) : ''}
  <!-- 窗与对楼 -->
  <rect x="36" y="70" width="190" height="250" fill="#0a1224" stroke="#191512" stroke-width="10"/>
  <line x1="131" y1="70" x2="131" y2="320" stroke="#191512" stroke-width="7"/><line x1="36" y1="195" x2="226" y2="195" stroke="#191512" stroke-width="7"/>
  ${[0,1,2,3,4,5,6,7,8,9,10,11].map(i => `<rect x="${52 + (i % 4) * 42}" y="${92 + Math.floor(i / 4) * 62}" width="17" height="22" fill="${i % 3 ? '#ffd98a' : '#2a3c5f'}" opacity="${i % 3 ? 0.85 : 0.7}"/>`).join('')}
  <rect x="36" y="320" width="190" height="10" fill="#241f19"/>
  <!-- 挂历 -->
  <rect x="268" y="86" width="86" height="110" fill="#ddd6c4"/><rect x="268" y="86" width="86" height="26" fill="#8e2323"/>
  <text x="311" y="105" font-size="15" fill="#fff" text-anchor="middle">7 月</text>
  <text x="311" y="152" font-size="30" fill="#2a2a2a" text-anchor="middle" font-weight="bold">19</text>
  <text x="311" y="180" font-size="11" fill="#666" text-anchor="middle">二〇一九 · 圈着一天</text>
  <!-- 全家福 -->
  <rect x="392" y="92" width="104" height="80" fill="#5a4632"/><rect x="400" y="100" width="88" height="64" fill="#c9bda6"/>
  <circle cx="424" cy="126" r="10" fill="#6b5844"/><circle cx="448" cy="122" r="11" fill="#584a3a"/><circle cx="468" cy="130" r="7" fill="#77644e"/>
  <text x="444" y="186" font-size="11" fill="#9a8f7a" text-anchor="middle">全家福 · 2018</text>
  <!-- 电视柜与电视 -->
  <rect x="560" y="300" width="300" height="96" fill="#2e2620"/><rect x="572" y="312" width="130" height="72" fill="#3a3128"/><rect x="716" y="312" width="130" height="72" fill="#3a3128"/>
  <rect x="616" y="150" width="216" height="140" rx="8" fill="#101014" stroke="#2c2c33" stroke-width="5"/>
  ${tv === 'off' ? `<rect x="626" y="160" width="196" height="120" fill="#15181f"/>` : tv === 'static' ? `<rect x="626" y="160" width="196" height="120" fill="#3d434e"/><text x="724" y="228" font-size="15" fill="#cfd6df" text-anchor="middle">雪 花</text>` : `<rect x="626" y="160" width="196" height="120" fill="#1d2a3a"/><rect x="640" y="176" width="60" height="88" fill="#2c4258"/><ellipse cx="718" cy="204" rx="13" ry="15" fill="#a8bccd"/><path d="M705 198 a13 11 0 0 1 26 0 l0 -4 -26 0Z" fill="#d8dde2"/><path d="M700 224 q18 -7 36 0 l3 34 -42 0Z" fill="#5d748c"/><g opacity="0.92"><path d="M782 262 L785 208 Q790 202 795 208 L798 262Z" fill="#0d1420"/><circle cx="790" cy="198" r="8.5" fill="#0d1420"/><rect x="771" y="228" width="9" height="12" fill="#cfd6df" transform="rotate(8 775 234)"/></g><text x="724" y="272" font-size="12.5" fill="#ffd76e" text-anchor="middle">2019-07-19 21:47 · 录像</text>`}
  <rect x="646" y="404" width="56" height="12" rx="3" fill="#191919"/>
  <!-- 沙发茶几 -->
  <rect x="60" y="392" width="250" height="86" rx="12" fill="#4b3f33"/><rect x="60" y="360" width="250" height="44" rx="12" fill="#584a3b"/>
  <rect x="352" y="420" width="170" height="16" rx="4" fill="#33291f"/><rect x="368" y="436" width="12" height="44" fill="#241c15"/><rect x="494" y="436" width="12" height="44" fill="#241c15"/>
  <ellipse cx="437" cy="414" rx="30" ry="6" fill="#6d5b45"/><rect x="560" y="402" width="34" height="20" rx="3" fill="#7a2d2d"/>
  <!-- 供桌 -->
  <rect x="308" y="272" width="262" height="14" fill="#3a2b1c"/>
  <rect x="322" y="286" width="14" height="120" fill="#2c2015"/><rect x="542" y="286" width="14" height="120" fill="#2c2015"/>
  <rect x="404" y="182" width="72" height="90" fill="#241d16"/><rect x="412" y="190" width="56" height="74" fill="#585046"/>
  <ellipse cx="440" cy="218" rx="12.5" ry="14.5" fill="#9a8a74"/>
  <path d="M427.5 212 a12.5 11 0 0 1 25 0 l0 -5 -25 0Z" fill="#cfc8ba"/>
  <path d="M432.5 217 q2.8 1.8 5.6 0" stroke="#2e2a24" stroke-width="1.3" fill="none"/>
  <path d="M441.9 217 q2.8 1.8 5.6 0" stroke="#2e2a24" stroke-width="1.3" fill="none"/>
  <line x1="440" y1="219" x2="439.2" y2="225" stroke="#6d5f4c" stroke-width="1.2"/>
  <path d="M435.5 230 q4.5 1.8 9 0" stroke="#4a4036" stroke-width="1.3" fill="none"/>
  <path d="M422 264 a18 12 0 0 1 36 0 z" fill="#6d6355"/>
  <text x="440" y="180" font-size="11" fill="#cbbf9f" text-anchor="middle">周守义</text>
  ${agg ? `<rect x="416" y="252" width="48" height="18" fill="#e6ddc4" stroke="#b8ab84" stroke-width="1.5"/><text x="440" y="265" font-size="9.5" fill="#5a4a2a" text-anchor="middle">明日契</text>` : ''}
  <rect x="416" y="284" width="48" height="10" rx="4" fill="#5d5348"/>
  ${[0,1,2,3].map(candleBase).join('')}
  <rect x="322" y="330" width="236" height="52" fill="#33271a"/><rect x="428" y="352" width="24" height="8" rx="3" fill="#191008"/>
  <!-- 落地钟 -->
  <rect x="786" y="120" width="76" height="290" rx="8" fill="#33241a"/>
  <circle cx="824" cy="172" r="30" fill="#e6ddc4"/><circle cx="824" cy="172" r="3.5" fill="#222"/>
  <line x1="824" y1="172" x2="824" y2="150" stroke="#222" stroke-width="3"/><line x1="824" y1="172" x2="838" y2="178" stroke="#222" stroke-width="3"/>
  <rect x="802" y="216" width="44" height="150" fill="#241a12"/><line x1="824" y1="222" x2="824" y2="330" stroke="#8a743f" stroke-width="3"/><circle cx="824" cy="338" r="11" fill="#8a743f"/>
  <!-- 卧室门与厨房开关 -->
  <rect x="238" y="150" width="86" height="256" fill="#241c15"/><circle cx="312" cy="286" r="6" fill="#b9bdc9"/>
  <text x="281" y="140" font-size="12" fill="#9a8f7a" text-anchor="middle">卧 室</text>
  <rect x="540" y="420" width="30" height="42" rx="3" fill="#d8d3c3"/><circle cx="555" cy="436" r="5" fill="${F('sw_kitchen') ? '#7dd87d' : '#8a8a8a'}"/>
  <rect x="244" y="412" width="30" height="42" rx="3" fill="#d8d3c3"/><circle cx="259" cy="428" r="5" fill="${F('sw_bath') ? '#7dd87d' : '#8a8a8a'}"/>
  ${porterFigure(128, 357, 2.1)}
  ${dark ? `<rect width="900" height="620" fill="#04050c" opacity="0.86"/><text x="450" y="300" font-size="19" fill="#5f6c8a" text-anchor="middle">屋里没电。只有窗外对楼的灯，和供桌上没点的烛。</text><text x="450" y="332" font-size="14.5" fill="#49536e" text-anchor="middle">先把闸合上——或者，借命。</text>` : ''}
  </svg>`;
}

function bedroomSvg() {
  const dark = !F('power') && !F('borrowPower');
  const wardOpen = F('wardOpen');
  return `<svg viewBox="0 0 900 620" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="bw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37342f"/><stop offset="1" stop-color="#201d19"/></linearGradient></defs>
  <rect width="900" height="440" fill="url(#bw)"/><rect y="440" width="900" height="180" fill="#171310"/>
  <!-- 窗 -->
  <rect x="640" y="66" width="200" height="230" fill="#0a1224" stroke="#14110d" stroke-width="9"/>
  <line x1="740" y1="66" x2="740" y2="296" stroke="#14110d" stroke-width="6"/>
  ${[0,1,2,3,4,5].map(i => `<rect x="${662 + (i % 3) * 56}" y="${92 + Math.floor(i / 3) * 74}" width="16" height="21" fill="${i % 2 ? '#ffd98a' : '#223453'}" opacity="0.85"/>`).join('')}
  <!-- 床 -->
  <rect x="60" y="330" width="380" height="52" rx="8" fill="#4d4438"/>
  <rect x="60" y="286" width="380" height="52" rx="10" fill="#6d6252"/>
  <rect x="76" y="252" width="120" height="44" rx="10" fill="#ddd5c2"/>
  <rect x="60" y="382" width="16" height="66" fill="#33291f"/><rect x="424" y="382" width="16" height="66" fill="#33291f"/>
  <rect x="196" y="300" width="228" height="30" rx="8" fill="#5d5344"/>
  <!-- 床头柜 -->
  <rect x="470" y="318" width="120" height="110" fill="#3a2f23"/>
  <rect x="482" y="332" width="96" height="36" fill="#473827"/><circle cx="530" cy="350" r="4.5" fill="#c9ccd6"/>
  ${F('bedDrawerOpen') ? `<rect x="482" y="376" width="96" height="40" fill="#171008"/><text x="530" y="401" font-size="11.5" fill="#cbbf9f" text-anchor="middle">病历本</text>` : `<rect x="482" y="376" width="96" height="40" fill="#473827"/><circle cx="530" cy="396" r="4.5" fill="#c9ccd6"/>`}
  <rect x="492" y="296" width="20" height="22" rx="3" fill="#c8b98a"/><rect x="520" y="300" width="26" height="18" rx="4" fill="#d8d3c3"/>
  <!-- 书桌与车票 -->
  <rect x="96" y="470" width="220" height="14" fill="#33291f"/><rect x="110" y="484" width="12" height="56" fill="#241c15"/><rect x="290" y="484" width="12" height="56" fill="#241c15"/>
  <rect x="150" y="446" width="86" height="26" rx="3" fill="#e6ddc4" transform="rotate(-4 193 459)"/>
  <text x="193" y="463" font-size="11" fill="#5a4a2a" text-anchor="middle">长途车票</text>
  <!-- 衣柜与保险箱 -->
  <rect x="636" y="330" width="230" height="180" fill="#2e241a"/>
  ${wardOpen ? `<rect x="646" y="340" width="100" height="160" fill="#171008"/><rect x="756" y="340" width="100" height="160" fill="#171008"/>
  <rect x="676" y="404" width="140" height="88" rx="6" fill="#23262e" stroke="#454b59" stroke-width="2.5"/>
  <circle cx="746" cy="436" r="15" fill="#171a21" stroke="#5a6274" stroke-width="2.5"/><circle cx="746" cy="436" r="4" fill="#9aa2b5"/>
  <text x="746" y="482" font-size="11" fill="#96a0b5" text-anchor="middle">保 险 箱</text>` :
  `<rect x="646" y="340" width="104" height="160" fill="#3a2c1e"/><rect x="752" y="340" width="104" height="160" fill="#3a2c1e"/><circle cx="742" cy="424" r="5" fill="#c9ccd6"/><circle cx="760" cy="424" r="5" fill="#c9ccd6"/>`}
  <rect x="470" y="486" width="34" height="40" rx="3" fill="#d8d3c3"/><circle cx="487" cy="500" r="4.5" fill="#8a8a8a"/>
  ${porterFigure(408, 356, 2.05)}
  ${dark ? `<rect width="900" height="620" fill="#04050c" opacity="0.86"/><text x="450" y="306" font-size="18" fill="#5f6c8a" text-anchor="middle">卧室更暗。先把电送回来。</text>` : ''}
  </svg>`;
}

function blackSvg() {
  return `<svg viewBox="0 0 900 620" preserveAspectRatio="xMidYMid slice"><rect width="900" height="620" fill="#030308"/>
  <text x="450" y="300" font-size="21" fill="#4d5871" text-anchor="middle">时 契 行</text>
  <text x="450" y="336" font-size="14" fill="#333d52" text-anchor="middle">柜台的铜牌上，刻着三条铁律</text></svg>`;
}

const SCENE_SVG = { black: blackSvg, corridor: corridorSvg, living: livingSvg, bedroom: bedroomSvg };

/* ---------------- 选择（数据驱动，可跨端） ---------------- */
ITEMS.roomkey = { name: '卧室钥匙', desc: '老式铜钥匙，齿口磨得发亮。' };
let pendingChoices = null;
function offer(list, actorId) { pendingChoices = { for: actorId === undefined ? myId() : actorId, list }; }
function flushChoices() {
  const pc = pendingChoices; pendingChoices = null;
  if (!pc) { dlgChoices = null; return; }
  if (isHostSide() && window.TDNet && TDNet.role === 'host') TDNet.broadcast({ t: 'choices', pc });
  if (pc.for === myId()) { dlgChoices = pc; }
}
function handleChoice(c) {
  dlgChoices = null;
  if (c.local) { localChoice(c.local); pumpDialog(); return; }
  if (c.act) doAct(c.act);
  pumpDialog();
}
function localChoice(key) {
  if (key === 'noop') return;
  if (key === 'kp:door') openKeypad('door');
  else if (key === 'kp:safe') openKeypad('safe');
  else if (key === 'clock') openClock();
}

/* ---------------- 同步 ---------------- */
let syncQueued = false;
function syncSoon() { if (!isHostSide()) return; if (syncQueued) return; syncQueued = true; setTimeout(() => { syncQueued = false; syncState(); }, 60); }
function syncState() {
  renderAll();
  if (window.TDNet && TDNet.role === 'host' && G) TDNet.broadcast({ t: 'gs', G });
  checkSealTrigger();
  checkEnd();
}
function applyState(newG) {
  G = newG;
  show($('menu'), false);
  show($('topbar'), true); show($('stage'), true); show($('invbar'), true);
  renderAll();
  checkSealTrigger();
  checkEnd();
}

/* ---------------- 动作引擎（房主执行） ---------------- */
function doAct(a, actorId) {
  if (!isHostSide()) { TDNet.send({ t: 'act', a }); return; }
  if (!G || !G.started || G.ended) return;
  const actor = actorId === undefined ? myId() : actorId;
  pendingLines = []; pendingChoices = null;
  actImpl(a, actor);
  flushSay(actor);
  flushChoices();
  syncState();
}

function borrowCommon(kind, actor) {
  G.debt++;
  G.borrows[kind] = (G.borrows[kind] || 0) + 1;
  beep(98, 0.35, 'sawtooth', 0.05);
}

function actImpl(a, actor) {
  switch (a.k) {
    case 'borrowHint': {
      borrowCommon('hint', actor);
      const def = STAGES.find(s => s.id === a.stage);
      G.hintUsed[a.stage] = 2;
      say('契纹（借命）', def.strong + '（命债 +1）');
      break;
    }
    case 'borrowDoor': {
      if (F('doorOpen')) break;
      borrowCommon('door', actor);
      setF('doorOpen');
      say('契纹', '你把手按在锁眼上，契纹烧出一线红光。锁舌自己退了回去。（命债 +1）');
      say('', '门开了。檀香味涌出来，浓得像水。');
      break;
    }
    case 'borrowPower': {
      if (F('power') || F('borrowPower')) break;
      borrowCommon('power', actor);
      setF('borrowPower');
      say('契纹', '契纹的光顺着墙爬了一圈，屋里亮起一层薄薄的、发青的光。够看清了。（命债 +1）');
      break;
    }
    case 'borrowSafe': {
      if (F('safeOpen')) break;
      borrowCommon('safe', actor);
      openSafe('契纹烧穿了锁芯。保险箱的门弹开一条缝。（命债 +1）');
      break;
    }
    case 'code': {
      if (a.ctx === 'door') {
        if (a.code === '0612') {
          setF('doorOpen');
          say('', '锁咔哒一声开了。2019 年之前，这家的密码就没换过——搬家那天的日子，他记了一辈子。');
        } else {
          G.flags.doorFails = (G.flags.doorFails || 0) + 1;
          say('', '密码不对，锁响了两声短促的警告。');
          if (G.flags.doorFails >= 2) say('送契人', '（楼道里能翻的东西不多。信箱、电表箱、门上的对联……搬家的日子，总该留在哪儿。）');
        }
      } else if (a.ctx === 'safe') {
        if (a.code === '0719') openSafe('锁开了。0719——他入院的那一天，他把密码设成了这一天，是怕自己忘掉为什么要活。');
        else say('', '保险箱响了一声闷响，密码不对。');
      }
      break;
    }
    case 'clock': {
      if (a.h === 3 && a.m === 15) {
        if (!F('clockSolved')) {
          setF('clockSolved');
          give('page1'); give('roomkey');
          say('', '钟摆重新走起来——走了三秒，又停了。钟座底部弹出一道暗格。');
          say('送契人', '暗格里躺着半页契文，和一把卧室钥匙。契文的上半页，原来一直睡在这只钟里。');
        } else say('', '钟又停在 3:15，不再动了。');
      } else {
        say('', '你把指针拨到 ' + a.h + ':' + (a.m < 10 ? '0' : '') + a.m + '，上弦。钟摆动了两下，停了——不是这一刻。');
      }
      break;
    }
    case 'switch': {
      toggleSwitch(a.id, actor);
      break;
    }
    case 'combine': {
      if (has('page1') && has('page2') && !has('contract')) {
        G.inv = G.inv.filter(i => i !== 'page1' && i !== 'page2');
        give('contract');
        setF('contractWhole');
        say('契', '两半页契文合上了。断口严丝合缝，像从来没被撕开过。');
      }
      break;
    }
    case 'placeContract': {
      if (!has('contract') || F('contractPlaced')) break;
      setF('contractPlaced');
      G.inv = G.inv.filter(i => i !== 'contract');
      say('', '你把完整的《明日契》放在遗像前，退后一步。');
      say('送契人', '行里的规矩：契到遗像前，还要点烛。烛点完，契才算送到。');
      break;
    }
    case 'startCandles': {
      if (!F('contractPlaced') || F('candlesDone')) break;
      const seq = [];
      for (let i = 0; i < G.candleSeqLen; i++) seq.push(Math.floor(Math.random() * 4));
      G.candle = { seq, phase: 'show', idx: 0, input: [], nextAt: G.time + 0.9 };
      say('送契人', '看好烛火亮起的顺序——' + G.candleSeqLen + ' 盏，' + (G.players > 1 ? '人越多，规矩越长。分工记。' : '记牢。'));
      break;
    }
    case 'candle': {
      const cd = G.candle;
      if (!cd || cd.phase !== 'input') break;
      const expect = cd.seq[cd.input.length];
      if (a.i === expect) {
        cd.input.push(a.i);
        chime(a.i);
        if (cd.input.length === cd.seq.length) {
          G.candle = null;
          setF('candlesDone');
          say('', '最后一盏烛点亮时，屋里所有的光一起矮了下去。');
          say('？？', '（供桌后面，有人轻轻地，像是等得太久，叹了口气。）');
          offer([{ label: '上前一步，封门', act: { k: 'openSeal' } }], actor);
        }
      } else {
        cd.input = [];
        say('', '顺序错了。烛火齐齐晃了一下，灭了一半——再点一次遗像，可以重看顺序。');
      }
      break;
    }
    case 'borrowSeal': {
      if (!F('candlesDone') || G.ended) break;
      borrowCommon('seal', actor);
      G.sealAid = true;
      G.sealSeq = (G.sealSeq || 0) + 1;
      say('契纹', '你咬破指尖，血按在门框上。印稳住了——画得粗些，它也认。（命债 +1）');
      break;
    }
    case 'openSeal': {
      G.sealFor = actor;
      G.sealSeq = (G.sealSeq || 0) + 1;
      say('送契人', '把手给我。接下来这一笔，你自己画。');
      break;
    }
    case 'ritual': {
      if (F('candlesDone') && !G.ended) {
        G.sealFor = null;
        finishChapter();
      }
      break;
    }
    case 'hs': {
      const hs = HOTSPOTS.find(h => h.id === a.id);
      if (hs && hs.onAct) hs.onAct(actor);
      break;
    }
  }
}

function openSafe(pre) {
  setF('safeOpen');
  give('page2'); give('letter');
  say('', pre);
  say('送契人', '保险箱里是契文的下半页，和一封没寄出的信。信封上写着：送契的小师傅亲启。');
}

const SWITCHES = ['meter', 'kitchen', 'bath'];
const SWITCH_VIEW = { meter: 'corridor', kitchen: 'living', bath: 'living' };
function requiredSwitches() { return SWITCHES.slice(0, clamp(G.players, 1, 3)); }
function toggleSwitch(id, actor) {
  if (F('power')) { say('', '电已经通了。'); return; }
  if (!requiredSwitches().includes(id)) { say('', '这把闸是邻居家的，别乱动。'); return; }
  if (G.players <= 1) G.switches[id] = Infinity;
  else G.switches[id] = G.time + 4.5;
  setF('sw_' + id);
  beep(740, 0.05, 'square', 0.03);
  const on = requiredSwitches().filter(s => (G.switches[s] === Infinity || (G.switches[s] || 0) > G.time)).length;
  say('', '你把分闸推了上去（' + on + ' / ' + requiredSwitches().length + '）。' + (G.players > 1 ? '多人时闸过几秒会自己跳掉，得让同伴在别处同时推。' : ''));
  checkPower();
}
function checkPower() {
  const req = requiredSwitches();
  if (req.every(id => G.switches[id] === Infinity || (G.switches[id] || 0) > G.time)) {
    setF('power');
    say('', '咔。整层楼的灯管闪了两下——302 的屋里，亮了。');
    say('送契人', '电视柜上的指示灯亮起一点红。这屋子，像是刚睡醒。');
  }
}

/* 房主节拍：分闸过期、点烛演示推进 */
setInterval(() => {
  if (!isHostSide() || !G || !G.started || G.ended) return;
  G.time += 0.5;
  let changed = false;
  if (!F('power')) {
    requiredSwitches().forEach(id => {
      const v = G.switches[id];
      if (v !== undefined && v !== Infinity && v <= G.time) {
        delete G.switches[id]; G.flags['sw_' + id] = false; changed = true;
        pendingLines = []; say('', '远处咔的一声——有一把分闸跳掉了。');
        flushSay(myId());
      }
    });
  }
  const cd = G.candle;
  if (cd && cd.phase === 'show' && G.time >= cd.nextAt) {
    cd.idx++; cd.nextAt = G.time + 0.85; changed = true;
    chime(cd.seq[Math.min(cd.idx, cd.seq.length - 1)]);
    if (cd.idx >= cd.seq.length) {
      cd.phase = 'input';
      pendingLines = []; say('送契人', '看完了。按刚才的顺序，把烛点回去。');
      flushSay(myId());
    }
  }
  if (changed) syncState();
}, 500);

/* ---------------- 热点与导航 ---------------- */
function hsAct(id, onAct) { return { id, kind: 'act', onAct }; }
const HOTSPOTS = [
  /* 楼道 */
  { view: 'corridor', id: 'mailbox', x: 55, y: 145, w: 225, h: 305, label: '信箱', kind: 'act', onAct(actor) {
    if (!F('mailLoot')) {
      setF('mailLoot'); give('postcard'); give('bill');
      say('', '302 的信箱塞满了广告，底下压着两张薄薄的纸：一张老明信片，一张电费催缴单。你都抽了出来。');
    } else say('', '信箱空了，只剩灰。');
  } },
  { view: 'corridor', id: 'meterbox', x: 666, y: 186, w: 72, h: 105, label: '电表箱', kind: 'act', onAct(actor) {
    say('', '电表箱里一排表。302 那块的玻璃蒙着灰，数字停在三年前——不对，还在极慢地走。没人用电，它走的是什么？');
  } },
  { view: 'corridor', id: 'sw_meter', x: 678, y: 232, w: 55, h: 56, label: '分闸 · 楼道', kind: 'act', onAct(actor) { toggleSwitch('meter', actor); } },
  { view: 'corridor', id: 'door', x: 460, y: 192, w: 160, h: 320, label: '302 的门', kind: 'nav', target: 'living',
    guard: () => F('doorOpen'),
    guardFail() {
      showLines([{ who: '', text: '防盗门，密码锁。门上的对联褪成粉红色，是三年前那一副。锁还活着。' }]);
      dlgChoices = { for: myId(), list: [
        { label: '输入密码', local: 'kp:door' },
        { label: '借命 · 烧开这把锁（+1 命债）', borrow: true, act: { k: 'borrowDoor' } }
      ] };
      renderChoices();
    } },
  { view: 'corridor', id: 'doorlock', x: 473, y: 292, w: 36, h: 92, label: '密码锁', kind: 'modal', local: 'kp:door', when: () => !F('doorOpen') },
  { view: 'corridor', id: 'stairs', x: 315, y: 175, w: 108, h: 250, label: '楼梯', kind: 'act', onAct(actor) {
    say('', '声控灯坏了，楼梯间黑着。往上是没人住的四层，往下是雨——今晚的雨，和三年前那晚一样大。');
  } },
  /* 客厅 */
  { view: 'living', id: 'tv', x: 620, y: 272, w: 165, h: 145, label: '电视', kind: 'act', onAct(actor) {
    if (!F('power') && !F('borrowPower')) { say('', '黑着。先把电送回来——光靠契纹的光，可带不动电视。'); return; }
    if (!F('power')) { say('', '契纹的光够看清屋子，可电视要的是电。分闸还没全合上。'); return; }
    if (!F('tvBattery')) {
      if (has('battery')) {
        setF('tvBattery'); G.inv = G.inv.filter(i => i !== 'battery');
        say('', '你把电池装进遥控器。红灯亮了——三年了，遥控器先等到了电。');
      } else { say('', '电视有电，可遥控器是死的——电池仓空着。老式遥控器，两节五号电池。'); return; }
    }
    if (!F('videoSeen')) {
      setF('tvOn'); setF('videoSeen');
      G.tvShow = (G.tvShow || 0) + 1;
      say('电视', '录像带自动转起来。画面里是医院的走廊，一个老人对着镜头，身后病房门牌写着 3 床。');
      say('周守义（录像）', '「小师傅，我不知道你哪天来。我把话留在这盘带子里。」');
      say('周守义（录像）', '「钟，停在三点一刻。那是我出院那天夜里，到家的时辰。从那天起，这个家的时间就停在那儿了——柜子，也认这个时辰。」');
      say('电视', '录像到此为止。最后三秒，画面角落里，站着一个背对镜头的人——穿着送契人的褂子，是师父。');
    } else { G.tvShow = (G.tvShow || 0) + 1; say('电视', '你又按下了播放键。角落里师父的背影，一动不动。'); }
  } },
  { view: 'living', id: 'remote', x: 640, y: 262, w: 130, h: 26, label: '遥控器', kind: 'act', onAct(actor) {
    say('', F('tvBattery') ? '遥控器的红灯亮着。' : '遥控器躺在茶几上，电池仓盖开着，空的。');
  } },
  { view: 'living', id: 'altar', x: 396, y: 186, w: 225, h: 330, label: '遗像与供桌', kind: 'act', onAct(actor) {
    if (G.candle) { say('', '烛还亮着，先把顺序走完。'); return; }
    if (F('candlesDone')) { say('', '烛齐了。供桌后面那声叹息，还没散。'); offer([{ label: '上前一步，封门', act: { k: 'openSeal' } }], actor); return; }
    if (F('contractPlaced')) { say('送契人', '契在遗像前了。还差点烛——看着顺序点，别抢。'); offer([{ label: '点烛（看顺序）', act: { k: 'startCandles' } }], actor); return; }
    if (has('contract')) { say('', '遗像里的老人看着你，眼睛是照片的眼睛，可你觉得他在等你手里那封契。'); offer([{ label: '把契放到遗像前', act: { k: 'placeContract' } }], actor); return; }
    say('', '遗像、香炉、三根没点的烛。相框玻璃上有一层灰，唯独眼睛的位置，被谁擦得干干净净。');
  } },
  { view: 'living', id: 'altar_drawer', x: 70, y: 490, w: 390, h: 120, label: '茶几抽屉', kind: 'act', onAct(actor) {
    if (!F('drawerOpen')) {
      setF('drawerOpen'); give('battery'); give('smallkey');
      say('', '茶几的抽屉里整整齐齐：两节电池，一把黄铜小钥匙，一叠黄纸。都是给今晚准备的——像是知道有人要来翻。');
    } else say('', '茶几抽屉空了。黄纸还在，压得平平整整。');
  } },
  { view: 'living', id: 'calendar', x: 492, y: 25, w: 120, h: 150, label: '挂历', kind: 'act', onAct(actor) {
    say('', '撕历停在 2019 年 7 月 19 日，那一天被红笔圈了三圈。之后的日子，一页都没撕过。');
  } },
  { view: 'living', id: 'photo', x: 398, y: 150, w: 80, h: 75, label: '全家福', kind: 'act', onAct(actor) {
    setF('photoSeen');
    say('', '全家福背面写着：「出院那天，儿子背我下楼。楼道里那盏灯，那天是亮的。」');
  } },
  { view: 'living', id: 'clock', x: 795, y: 30, w: 105, h: 520, label: '落地挂钟', kind: 'modal', local: 'clock' },
  { view: 'living', id: 'bedroom_door', x: 300, y: 120, w: 85, h: 300, label: '卧室门', kind: 'nav', target: 'bedroom',
    guard: () => has('roomkey'),
    guardFail() { showLines([{ who: '', text: '卧室门锁着。锁眼是老式的——得找到这把门的钥匙。（钟，认一个时刻。）' }]); } },
  { view: 'living', id: 'sw_kitchen', x: 408, y: 238, w: 26, h: 34, label: '分闸 · 厨房', kind: 'act', onAct(actor) { toggleSwitch('kitchen', actor); } },
  { view: 'living', id: 'sofa', x: 0, y: 345, w: 290, h: 270, label: '沙发', kind: 'act', onAct(actor) {
    say('', '沙发扶手上搭着一件中山装，口袋是空的。坐垫中间凹下去一块——有人在这儿坐着等过很久。');
  } },
  /* 卧室 */
  { view: 'bedroom', id: 'bed', x: 5, y: 265, w: 480, h: 340, label: '床', kind: 'act', onAct(actor) {
    say('', '被子叠成豆腐块。枕边放着一本相册，第一页是孙女满月的照片，背面写着：「看见了。够本了。」');
  } },
  { view: 'bedroom', id: 'bedDrawer', x: 342, y: 300, w: 108, h: 128, label: '床头柜', kind: 'act', onAct(actor) {
    if (F('bedDrawerOpen')) { say('', '抽屉开着。病历本你已经拿走了，只剩一板吃了一半的药。'); return; }
    if (has('smallkey')) {
      setF('bedDrawerOpen'); give('medical');
      say('', '小钥匙对上了。抽屉里是一本病历，和一封压在病历下面的车票底联的复印件。你收好病历。');
    } else say('', '床头柜的抽屉锁着。小锁眼，黄铜的——得有把小钥匙。');
  } },
  { view: 'bedroom', id: 'desk', x: 570, y: 410, w: 325, h: 200, label: '书桌', kind: 'act', onAct(actor) {
    if (!F('ticketTaken')) { setF('ticketTaken'); give('ticket'); say('', '桌上压着一张长途车票：明早 06:40，城郊汽车站发车，座位 12。日期是明天——这张票还没过期，因为它等的明天，还没来。'); }
    else say('', '桌上还有半杯水。水面平的，像三年来没人碰过。');
  } },
  { view: 'bedroom', id: 'wardrobe', x: 445, y: 30, w: 295, h: 520, label: '衣柜', kind: 'act', onAct(actor) {
    if (!F('wardOpen')) { setF('wardOpen'); say('', '衣柜门滑开。衣服按季节挂得整齐，最底层——嵌着一只保险箱。'); }
    else say('', '衣柜里是他的四季。最底层的保险箱，等着一个日子。');
  } },
  { view: 'bedroom', id: 'safe', x: 495, y: 384, w: 153, h: 143, label: '保险箱', kind: 'act', when: () => F('wardOpen'), onAct(actor) {
    if (F('safeOpen')) { say('', '保险箱开着，空了。契和信，你都拿走了。'); return; }
    say('', '四位密码。箱体冰凉，凉得不像在屋里放了三年，像在别处放了很久。');
    offer([
      { label: '输入密码', local: 'kp:safe' },
      { label: '借命 · 烧穿它（+1 命债）', borrow: true, act: { k: 'borrowSafe' } }
    ], actor);
  } },
  { view: 'bedroom', id: 'sw_bed', x: 330, y: 110, w: 70, h: 60, label: '配电箱', kind: 'act', onAct(actor) { say('', '卧室墙上的配电箱是备用闸，推上去没有反应——要合的闸不在这间屋。'); } },
  { view: 'living', id: 'sw_bath', x: 660, y: 330, w: 24, h: 32, label: '分闸 · 卫浴', kind: 'act', onAct(actor) { toggleSwitch('bath', actor); } },
  { view: 'bedroom', id: 'bwindow', x: 745, y: 15, w: 150, h: 340, label: '窗', kind: 'act', onAct(actor) {
    say('', '对楼还亮着几盏灯。有一盏，在你看它的时候，灭了。');
  } }
];
/* 点烛热点（演示与输入阶段） */
for (let i = 0; i < 4; i++) {
  HOTSPOTS.push({ view: 'living', id: 'candle' + i, x: 488 + i * 26, y: 288, w: 24, h: 56, label: '烛 ' + (i + 1), kind: 'act',
    when: () => !!(G && G.candle && G.candle.phase === 'input'),
    onAct(actor) { actImpl({ k: 'candle', i }, actor); } });
}

/* 场景渲染：把矢量场景画到画布上（某些内置预览器不渲染内联 SVG，画布则与旧版同一通道）；
   画布不可用时退回内联 SVG。 */
const sceneImgCache = {};
function paintScene(svgStr) {
  const wrap = $('scene');
  const stage = $('frame');
  const w = stage && stage.clientWidth, h = stage && stage.clientHeight;
  if (!w || !h || typeof Image === 'undefined' || !window.URL || !URL.createObjectURL) { wrap.innerHTML = svgStr; return; }
  let cv = $('scene-canvas');
  if (!cv || cv.parentNode !== wrap) { wrap.innerHTML = '<canvas id="scene-canvas"></canvas>'; cv = $('scene-canvas'); }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const draw = img => {
    const ctx = cv.getContext('2d');
    if (!ctx) { wrap.innerHTML = svgStr; return; }
    const s = Math.max(cv.width / 900, cv.height / 620);
    const dw = 900 * s, dh = 620 * s;
    ctx.fillStyle = '#0a0c16'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
  };
  if (sceneImgCache[svgStr]) { draw(sceneImgCache[svgStr]); return; }
  try {
    const full = svgStr.replace('<svg ', '<svg width="900" height="620" xmlns="http://www.w3.org/2000/svg" ');
    const url = URL.createObjectURL(new Blob([full], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => { sceneImgCache[svgStr] = img; draw(img); URL.revokeObjectURL(url); };
    img.onerror = () => { wrap.innerHTML = svgStr; };
    img.src = url;
  } catch (e) { wrap.innerHTML = svgStr; }
}
if (window.addEventListener) {
  let rszT = null;
  window.addEventListener('resize', () => { clearTimeout(rszT); rszT = setTimeout(() => { if (G) renderScene(); }, 180); });
}

/* 实景图（AI 生成的写实场景）＋状态叠加层；序章仍用矢量兜底 */
const PHOTOS = { corridor: 'assets/corridor.jpg', living: 'assets/living.jpg', bedroom: 'assets/bedroom.jpg' };
let closedTvShow = 0;
function pct(x, y, w, h) { return 'left:' + (x / 9) + '%;top:' + (y / 6.2) + '%;width:' + (w / 9) + '%;height:' + (h / 6.2) + '%;'; }
function renderFx() {
  const fx = $('fx');
  let html = '';
  const dark = !F('power') && !F('borrowPower');
  let tvFull = false;
  if (myView === 'corridor') {
    if (F('doorOpen')) html += '<div class="door-open" style="' + pct(463, 198, 157, 318) + '"></div>';
    if (F('sw_meter')) html += '<div class="sw-on" style="left:79.5%;top:41%;"></div>';
  }
  if ((myView === 'living' || myView === 'bedroom') && dark) {
    html += '<div class="fx-dark"><p>' + (myView === 'living' ? '屋里没电。只有窗外对楼的灯，<br>和供桌上没点的烛。' : '卧室更暗。先把电送回来。') + '</p></div>';
  }
  if (myView === 'living' && !dark) {
    if (F('tvOn') && !F('videoSeen')) html += '<div class="tv-static" style="' + pct(640, 295, 118, 98) + '"></div>';
    if (F('contractPlaced')) html += '<div class="paper" style="' + pct(492, 326, 62, 28) + '"></div>';
    if (F('sw_kitchen')) html += '<div class="sw-on" style="left:47%;top:41%;"></div>';
    if (F('sw_bath')) html += '<div class="sw-on" style="left:74.5%;top:55.5%;"></div>';
    const cd = G.candle;
    const litSet = new Set();
    if (F('candlesDone')) { for (let i = 0; i < 4; i++) litSet.add(i); }
    else if (cd) {
      if (cd.phase === 'show' && cd.idx > 0) litSet.add(cd.seq[cd.idx - 1]);
      if (cd.phase === 'input' && cd.input.length) litSet.add(cd.input[cd.input.length - 1]);
    }
    litSet.forEach(i => { html += '<div class="flame" style="left:' + (54.6 + i * 2.8) + '%;top:45.4%;"></div>'; });
    if (F('candlesDone') && !G.ended) html += '<div class="shadow-fig" style="left:46.5%;top:16.5%;width:8.5%;height:36%;"><div class="sf-body"></div><div class="sf-head"></div><div class="sf-eye" style="left:36%;"></div><div class="sf-eye" style="left:57%;"></div></div>';
    if (G.tvShow && G.tvShow !== closedTvShow && F('videoSeen')) { tvFull = true; html += '<div class="tv-full" id="tv-full"><img src="assets/tv.jpg" alt=""></div>'; }
  }
  if (myView === 'bedroom' && F('wardOpen')) {
    html += '<div class="ward-open" style="' + pct(498, 380, 160, 152) + '"></div>';
    html += '<div class="safe-box' + (F('safeOpen') ? ' open' : '') + '" style="' + pct(508, 392, 144, 126) + '"><div class="dial"></div></div>';
  }
  fx.style.zIndex = tvFull ? 6 : 3;
  fx.innerHTML = html;
  const tf = $('tv-full');
  if (tf) tf.onclick = () => { closedTvShow = G.tvShow; renderFx(); };
}

function renderScene() {
  if (myView === 'black' || !PHOTOS[myView]) {
    paintScene((SCENE_SVG[myView] || blackSvg)());
    $('fx').innerHTML = '';
  } else {
    $('scene').innerHTML = '<img class="photo" src="' + PHOTOS[myView] + '" alt="">';
    renderFx();
  }
  const layer = $('hotspots'); layer.innerHTML = '';
  if (!G) return;
  HOTSPOTS.filter(h => h.view === myView && (!h.when || h.when())).forEach(h => {
    const b = document.createElement('button');
    b.className = 'hs';
    b.style.left = (h.x / 9) + '%'; b.style.top = (h.y / 6.2) + '%';
    b.style.width = (h.w / 9) + '%'; b.style.height = (h.h / 6.2) + '%';
    b.innerHTML = '<span class="hs-tag">' + h.label + '</span>';
    b.onclick = ev => {
      ev.stopPropagation();
      if (h.kind === 'nav') {
        if (!h.guard || h.guard()) { myView = h.target; beep(500, 0.04, 'sine', 0.02); renderScene(); updateNavBack(); }
        else if (h.guardFail) h.guardFail();
      } else if (h.kind === 'modal') {
        localChoice(h.local);
      } else {
        doAct({ k: 'hs', id: h.id });
      }
    };
    layer.appendChild(b);
  });
  updateNavBack();
}
function updateNavBack() {
  const nb = $('navback');
  if (!nb) return;
  if (myView === 'living') { nb.textContent = '← 回楼道'; nb.dataset.to = 'corridor'; show(nb, true); }
  else if (myView === 'bedroom') { nb.textContent = '← 回客厅'; nb.dataset.to = 'living'; show(nb, true); }
  else show(nb, false);
}
function renderAll() {
  if (!G) return;
  renderTop(); renderInv(); renderScene();
}

/* ---------------- 密码与挂钟（本地 UI，提交走 doAct） ---------------- */
let kpBuf = '';
function openKeypad(ctx) {
  kpCtx = ctx; kpBuf = '';
  $('kp-title').textContent = ctx === 'door' ? '302 · 密码锁' : '保险箱';
  updKp();
  const grid = $('kp-grid'); grid.innerHTML = '';
  ['1','2','3','4','5','6','7','8','9','⌫','0','✓'].forEach(d => {
    const b = document.createElement('button');
    b.className = 'kp-key'; b.textContent = d;
    b.onclick = () => {
      if (d === '⌫') kpBuf = kpBuf.slice(0, -1);
      else if (d === '✓') {
        if (kpBuf.length === 4) { show($('keypad'), false); doAct({ k: 'code', ctx: kpCtx, code: kpBuf }); }
        else buzz();
        return;
      } else if (kpBuf.length < 4) { kpBuf += d; beep(600 + Number(d) * 20, 0.04, 'sine', 0.025); }
      updKp();
    };
    grid.appendChild(b);
  });
  show($('keypad'), true);
}
function updKp() { $('kp-display').textContent = (kpBuf + '____').slice(0, 4); }
$('btn-kp-cancel').addEventListener('click', () => show($('keypad'), false));

function openClock() {
  clockVal = { h: 3, m: 0 };
  updClock();
  show($('clockui'), true);
}
function updClock() { $('clock-face').textContent = (clockVal.h < 10 ? '0' : '') + clockVal.h + ':' + (clockVal.m < 10 ? '0' : '') + clockVal.m; }
document.querySelectorAll('[data-ck]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.ck;
  if (k === 'h+') clockVal.h = (clockVal.h + 1) % 24;
  if (k === 'h-') clockVal.h = (clockVal.h + 23) % 24;
  if (k === 'm+') clockVal.m = (clockVal.m + 5) % 60;
  if (k === 'm-') clockVal.m = (clockVal.m + 55) % 60;
  beep(480, 0.03, 'sine', 0.02); updClock();
}));
$('btn-clock-set').addEventListener('click', () => { show($('clockui'), false); doAct({ k: 'clock', h: clockVal.h, m: clockVal.m }); });
$('btn-clock-cancel').addEventListener('click', () => show($('clockui'), false));

/* ---------------- 封门仪式（画符，保留自旧版的绕圈封印手感） ---------------- */
let sealDraw = null;
function checkSealTrigger() {
  if (G && G.sealFor === myId() && (G.sealSeq || 0) !== (window._sq || 0)) {
    window._sq = G.sealSeq;
    startSeal();
  }
}
function checkEnd() {
  if (G && G.ended && !window._endShown) {
    window._endShown = true;
    $('end-title').textContent = G.endTitle || '契，送到了';
    $('end-stats').textContent = G.endStats || '';
    show($('end'), true);
  }
}
function startSeal() {
  const cv = $('seal-canvas');
  const cx = cv.getContext('2d');
  const aid = !!(G && G.sealAid);
  $('seal-note').textContent = aid
    ? '借命稳住了印：时间放宽，圈画得粗些也认。用手指或鼠标画一个闭合的圈，圈住中央的契纹。'
    : '用手指或鼠标，在门上画一个闭合的圈，圈住中央的契纹。影子在靠近。';
  show($('sealui'), true);
  const W2 = cv.width, H2 = cv.height;
  const mark = { x: W2 / 2, y: H2 / 2 };
  const limit = aid ? 60 : 30;
  const t0 = Date.now();
  sealDraw = { pts: [], drawing: false, done: false };
  function draw() {
    const el = (Date.now() - t0) / 1000;
    const left = Math.max(0, limit - el);
    $('seal-timer').textContent = '它离门还有 ' + left.toFixed(0) + ' 秒';
    cx.fillStyle = '#160a12'; cx.fillRect(0, 0, W2, H2);
    cx.strokeStyle = 'rgba(230,220,200,0.25)'; cx.lineWidth = 3;
    cx.strokeRect(70, 26, W2 - 140, H2 - 52);
    /* 逼近的影子：从右边缘向门心靠 */
    const sx = W2 - 40 - (el / limit) * (W2 / 2 - 30);
    cx.fillStyle = 'rgba(8,6,10,0.88)';
    cx.beginPath(); cx.arc(sx, H2 / 2, 44, 0, 7); cx.fill();
    cx.fillStyle = 'rgba(255,120,140,0.85)';
    cx.beginPath(); cx.arc(sx - 13, H2 / 2 - 8, 4, 0, 7); cx.arc(sx + 13, H2 / 2 - 8, 4, 0, 7); cx.fill();
    /* 契纹 */
    cx.strokeStyle = '#ffd76e'; cx.lineWidth = 2.4;
    cx.beginPath(); cx.arc(mark.x, mark.y, 40, 0, 7); cx.stroke();
    cx.fillStyle = '#ffd76e'; cx.font = 'bold 30px sans-serif'; cx.textAlign = 'center';
    cx.fillText('契', mark.x, mark.y + 11);
    /* 玩家轨迹 */
    if (sealDraw.pts.length > 1) {
      cx.strokeStyle = '#ff5442'; cx.lineWidth = 3.4; cx.lineJoin = 'round';
      cx.beginPath();
      sealDraw.pts.forEach((p, i) => { if (i === 0) cx.moveTo(p.x, p.y); else cx.lineTo(p.x, p.y); });
      cx.stroke();
    }
    if (left <= 0 && !sealDraw.done) {
      sealDraw.done = true;
      stopSeal();
      show($('sealui'), false);
      toast('影子穿过了门——它退了半步，还会再来。点遗像可以再封一次。', 2800);
      beep(82, 0.4, 'sawtooth', 0.06);
    }
  }
  const timer = setInterval(() => { if (!sealDraw) { clearInterval(timer); return; } draw(); }, 100);
  sealDraw.stop = () => { clearInterval(timer); };
  draw();
  function pos(ev) {
    const r = cv.getBoundingClientRect();
    const src = ev.touches ? ev.touches[0] : ev;
    return { x: (src.clientX - r.left) * (W2 / r.width), y: (src.clientY - r.top) * (H2 / r.height) };
  }
  function ptIn(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function area(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    return Math.abs(a / 2);
  }
  function move(ev) {
    if (!sealDraw || !sealDraw.drawing || sealDraw.done) return;
    ev.preventDefault();
    const p = pos(ev);
    const pts = sealDraw.pts;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 7) return;
    pts.push(p);
    const tol = aid ? 44 : 28, minArea = aid ? 2400 : 4800;
    for (let i = 0; i < pts.length - 20; i++) {
      if (Math.hypot(p.x - pts[i].x, p.y - pts[i].y) < tol) {
        const poly = pts.slice(i);
        if (area(poly) > minArea && ptIn(mark.x, mark.y, poly)) {
          sealDraw.done = true;
          stopSeal();
          show($('sealui'), false);
          beep(392, 0.3, 'triangle', 0.06);
          doAct({ k: 'ritual' });
        }
        break;
      }
    }
  }
  function stopSeal() { if (sealDraw && sealDraw.stop) sealDraw.stop(); sealDraw = null; }
  cv.onpointerdown = ev => { if (sealDraw) { sealDraw.drawing = true; sealDraw.pts = [pos(ev)]; } };
  cv.onpointermove = move;
  window.onpointerup = () => { if (sealDraw) sealDraw.drawing = false; };
  $('btn-seal-giveup').onclick = () => { stopSeal(); show($('sealui'), false); };
  $('btn-seal-borrow').onclick = () => { stopSeal(); show($('sealui'), false); doAct({ k: 'borrowSeal' }); };
}

/* ---------------- 开局与结算 ---------------- */
const PROLOGUE = [
  { who: '送契人', text: '时契行没有招牌。柜台的铜牌上刻着三条铁律，我背了三年：' },
  { who: '铁律', text: '一、契向未来借——你借的命，是未来的你在替你过。债主，永远是未来的你自己。' },
  { who: '铁律', text: '二、契须亲手送达，隔手无效。逾期未达的契，会自己找路。' },
  { who: '铁律', text: '三、见契纹者，皆欠债人。' },
  { who: '送契人', text: '师父姓陆。三年前一个雨夜，他出门送一封契，再没回来。行里的规矩：送契人死在路上，未送达的契，徒弟接着送。' },
  { who: '送契人', text: '那封契在柜上压了三年。今晚，我把它送到——老居民楼，302，周守义。' },
  { who: '', text: '雨还在下。楼道灯亮着，像是专门为你亮的。' }
];
function startGame() {
  if (window.TDNet && TDNet.role === 'guest') { TDNet._status('你是客人，等房主点「开始送契」'); return; }
  const count = window.TDNet && TDNet.role === 'host' ? TDNet.playerCount() : 1;
  G = newGame(count);
  const ids = []; for (let i = 0; i < count; i++) ids.push(i);
  G.pages = { page1: ids[0], page2: ids[count > 1 ? 1 : 0] };
  window._endShown = false; window._sq = 0;
  mySel = null; myView = 'black';
  show($('menu'), false); show($('end'), false);
  show($('topbar'), true); show($('stage'), true); show($('invbar'), true);
  pendingLines = PROLOGUE.slice(); pendingChoices = null;
  flushSay(0); flushChoices();
  dlgOnDone = () => { if (myView === 'black') { myView = 'corridor'; renderScene(); } };
  syncState();
}
function finishChapter() {
  G.ended = true;
  const mins = Math.max(1, Math.round((Date.now() - G.t0) / 60000));
  G.endTitle = '契，送到了';
  G.endStats = '第一章《老居民楼》完。\n影子在印合上的那一刻退回了门后——它没有消失，它只是对完了这一笔账。\n\n用时约 ' + mins + ' 分钟 · 命债 ' + G.debt + ' 笔' + (G.debt === 0 ? '（一笔没借。行里老人说，这样的人，一辈子没几个。）' : G.debt <= 2 ? '（账还算轻。）' : '（账不轻。终局那天，一起算。）') + '\n同行 ' + G.players + ' 人\n\n下一章：县医院旧住院部 · 3 床——他借命三年住过的地方。病历里，还夹着「息」是怎么算的。（制作中）';
  pendingLines.push({ who: '周守义', text: '（印合上之前，你听见门后的人说：小师傅，替我谢谢你师父。雨大，他没走到——我不怪他。）' });
}
$('btn-start').addEventListener('click', startGame);
$('btn-again').addEventListener('click', () => { show($('end'), false); startGame(); });
$('btn-tomenu').addEventListener('click', () => location.reload());
$('btn-mute2').addEventListener('click', e => { muted = !muted; e.target.textContent = muted ? '×' : '♪'; });
$('navback').addEventListener('click', () => { myView = $('navback').dataset.to; renderScene(); });
(function wireSense() {
  const b = $('btn-sense'), st = $('stage');
  if (!b || !st) return;
  const on = e => { e.preventDefault(); st.classList.add('sensing'); };
  const off = () => st.classList.remove('sensing');
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('contextmenu', e => e.preventDefault());
})();

/* ---------------- 联机接线 ---------------- */
if (window.TDNet) {
  TDNet.onStatus = s => { $('net-status').textContent = s; };
  $('btn-host').addEventListener('click', () => TDNet.host());
  $('btn-join').addEventListener('click', () => TDNet.join($('room-input').value));
  TDNet.onGuestMsg = (d, gid) => { if (d.t === 'act') doAct(d.a, gid); };
  TDNet.onMsg = d => {
    if (d.t === 'gs') applyState(d.G);
    else if (d.t === 'lines') showLines(d.lines);
    else if (d.t === 'choices') { if (d.pc.for === myId()) { dlgChoices = d.pc; renderChoices(); show($('dialog'), true); } }
  };
  TDNet.onRoster = () => { if (isHostSide() && G && G.started && !G.ended) syncState(); };
}
show($('menu'), true);
