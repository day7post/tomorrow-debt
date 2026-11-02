'use strict';
/* 《明日债 · Tomorrow's Debt》 v0.3.0「同行」
   v0.3 新增（按玩家要求）：可联机 + 有解谜。
   联机：双人合作三种进入方式——单人 / 同屏双人（Enter 加入，随时离线可玩）/
        在线双人（PeerJS WebRTC 房间码，房主权威：房主跑逻辑，客人发输入收快照）。
   解谜：每幕一个，嵌在波次之间——
        一幕「踏符阵」记序踏符；二幕「双生祟」必须同一道印同时封住双生；
        三幕「契文三问」站圈答题，答错会给最终 Boss 上强度。
   合作机制：各自拖朱砂/青砂轨迹绕圈封印；队友倒地后，绕着他合印可救回。
   核心战斗与借债/讨债影沿用 v0.2。 */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize); resize();

/* ---------------- 工具 ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a / 2);
}
function centroid(poly) {
  let x = 0, y = 0;
  poly.forEach(p => { x += p.x; y += p.y; });
  return { x: x / poly.length, y: y / poly.length };
}

/* ---------------- 音效 ---------------- */
let muted = false, audioCtx = null;
function beep(freq, dur, type, vol) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.value = vol || 0.04;
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* 静默 */ }
}

/* ---------------- 三幕 ---------------- */
const SCENES = [
  {
    name: '第一幕 · 雨夜凶宅', theme: 'house',
    top: '#0a0d1c', bottom: '#020308', accent: '#9fb7ff', enemy: '#e6e1d5',
    story: '老宅的门，自己开了。\n契主坐在堂屋正中——他已经过世三年了。\n行里规矩：活人不接死人的契。\n可《明日契》最后一页写着：债主，是未来的你。\n你没有武器，只有一支朱砂笔。绕着它们走满一圈，印合上，才封得住。',
    waves: [
      { chaser: 6, dart: 0, tank: 0, lurker: 0 },
      { chaser: 8, dart: 3, tank: 0, lurker: 0 },
      { chaser: 8, dart: 4, tank: 1, lurker: 1 }
    ]
  },
  {
    name: '第二幕 · 停尸走廊', theme: 'ward',
    top: '#0a120e', bottom: '#010403', accent: '#8fe3b0', enemy: '#cfe6cf',
    story: '送契的路穿过废弃医院的停尸走廊，灯一盏盏灭下去。\n尽头的停尸牌上挂着明天的日期，名字是你的。\n你开始分不清——是你在把契送向死人，\n还是它在把你，一步一步送过去。',
    waves: [
      { chaser: 7, dart: 4, tank: 1, lurker: 2 },
      { chaser: 9, dart: 5, tank: 2, lurker: 2 },
      { chaser: 10, dart: 6, tank: 2, lurker: 3 }
    ]
  },
  {
    name: '第三幕 · 血月祭坛', theme: 'altar',
    top: '#1d0509', bottom: '#040102', accent: '#ff6a5e', enemy: '#ffb3a7',
    story: '血月升到祭坛正上方，收契的人坐在坛心。\n他抬起头——是死去多年后，你自己的脸。\n「契，我收。」他说，\n「借我的命，一笔一笔，绕着我走回来还。」',
    waves: [
      { chaser: 10, dart: 6, tank: 2, lurker: 3 },
      { chaser: 12, dart: 8, tank: 3, lurker: 4 },
      { boss: true }
    ]
  }
];

const UPGRADES = [
  { name: '镇煞契', desc: '全队封印伤害 +30%', apply: p => { p.sealDmg *= 1.30; } },
  { name: '朱砂契', desc: '全队轨迹存留时间 +40%，能绕更大的圈', apply: p => { p.trailLife *= 1.40; } },
  { name: '疾风契', desc: '全队移动速度 +13%', apply: p => { p.speed *= 1.13; } },
  { name: '扩命契', desc: '全队生命上限 +25，并回复 40', apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 40); } },
  { name: '破煞契', desc: '全队封印暴击率 +15%', apply: p => { p.crit += 0.15; } },
  { name: '磁石契', desc: '全队拾取范围 +70%', apply: p => { p.magnet *= 1.7; } },
  { name: '疾影契', desc: '全队冲刺冷却 -30%，冲刺后短暂加速', apply: p => { p.dashCdMax *= 0.7; p.dashBoost = true; } },
  { name: '连环契', desc: '全队每次封印后 3 秒内，下一次封印伤害 +60%', apply: p => { p.chainSeal = true; } }
];

/* ---------------- 状态 ---------------- */
const SKILL_CD = { nova: 7, blades: 12, chrono: 14 };
const SKILL_NAME = { nova: '阴爆', blades: '纸人', chrono: '凝时' };
const DEBT_DELAY = 22;
const PUZZLE_AT = [1, 1, 2]; // 每幕在第几波之后出谜题

let state = 'menu';
let endless = false;
let players = [], player = null;
let enemies = [], shadows = [], parts = [], drops = [], debts = [], ebullets = [], sealFx = [];
let sceneIdx = 0, waveIdx = 0, spawnQueue = [], spawnTimer = 0, waveActive = false;
let score = 0, kills = 0, seals = 0, debtsTotal = 0, debtsRepaid = 0, runTime = 0;
let borrowedSet = new Set(), borrowedHistory = [];
let slowTimer = 0, shake = 0, bossRef = null;
let puzzle = null, puzzleDone = [false, false, false], bossBuff = 0; // bossBuff: -1 弱化 / +1 强化
let keys = {};
let joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
let rings = [];

function newPlayer(kind, idx) {
  return {
    kind, idx,
    x: W / 2 + (idx === 1 ? 70 : -10), y: H / 2 + (idx === 1 ? 40 : 0), r: 14,
    hp: 100, maxHp: 100, downed: false, reviveTimer: 0,
    speed: 242, sealDmg: 85, trailLife: 7, crit: 0.05, magnet: 60, chainSeal: false,
    dashTimer: 0, dashCd: 0, dashCdMax: 2.6, dashBoost: false, boostTimer: 0, face: 1,
    skillCd: { nova: 0, blades: 0, chrono: 0 },
    paperTimer: 0, paperAngle: 0, invuln: 0, sealBuffTimer: 0,
    trail: [], input: { mx: 0, my: 0 }
  };
}

function resetRun(isEndless) {
  endless = isEndless;
  player = newPlayer('local1', 0);
  players = [player];
  // 在线客人或同屏 P2 若在开局前已加入，保留席位
  if (window.TDNet && TDNet.role === 'host' && TDNet.conn && TDNet.conn.open) addPlayer('remote');
  enemies = []; shadows = []; parts = []; drops = []; debts = []; ebullets = []; sealFx = []; rings = [];
  sceneIdx = 0; waveIdx = 0; score = 0; kills = 0; seals = 0;
  debtsTotal = 0; debtsRepaid = 0; runTime = 0;
  borrowedSet = new Set(); borrowedHistory = [];
  slowTimer = 0; bossRef = null; spawnQueue = []; waveActive = false;
  puzzle = null; puzzleDone = [false, false, false]; bossBuff = 0;
}

function addPlayer(kind) {
  if (players.length >= 2) return null;
  const p = newPlayer(kind, 1);
  players.push(p);
  updateP2HudVisibility();
  return p;
}

function viewPl() {
  if (window.TDNet && TDNet.role === 'guest') return players[1] || players[0] || player;
  return player;
}
function alivePlayers() { return players.filter(p => !p.downed); }
function nearestPlayer(x, y) {
  let best = null, bd = Infinity;
  alivePlayers().forEach(p => { const d = dist2(p, { x, y }); if (d < bd) { bd = d; best = p; } });
  return best;
}

/* ---------------- DOM ---------------- */
const $ = id => document.getElementById(id);
const els = {
  hud: $('hud'), skills: $('skills'), menu: $('menu'), chapter: $('chapter'),
  upgrade: $('upgrade'), end: $('end'), pause: $('pause'),
  hpFill: $('hpfill'), hpText: $('hptext'), p2wrap: $('p2wrap'), p2fill: $('p2fill'), p2text: $('p2text'),
  scene: $('scene-label'), wave: $('wave-label'),
  debtCount: $('debt-count'), scoreCount: $('score-count'), debtAlert: $('debt-alert'),
  chapterTitle: $('chapter-title'), chapterText: $('chapter-text'),
  endTitle: $('end-title'), endStats: $('end-stats'), best: $('best-line'),
  endlessBtn: $('btn-endless'), netStatus: $('net-status')
};
function show(el, on) { el.classList.toggle('hidden', !on); }
function updateP2HudVisibility() { show(els.p2wrap, players.length > 1); }
function refreshBest() {
  const best = JSON.parse(localStorage.getItem('td_best') || 'null');
  els.best.textContent = best ? ('最佳：时尘 ' + best.score + ' · 封印 ' + (best.seals || 0) + ' 次 · 总借债 ' + best.debts) : '';
  show(els.endlessBtn, !!localStorage.getItem('td_won'));
}
refreshBest();
function alertText(txt, ms) {
  els.debtAlert.textContent = txt;
  show(els.debtAlert, true);
  setTimeout(() => show(els.debtAlert, false), ms || 1700);
}

/* ---------------- 流程 ---------------- */
function startRun(isEndless) {
  if (window.TDNet && TDNet.role === 'guest') { TDNet._status('你是客人，等房主点「开始送契」'); return; }
  resetRun(isEndless);
  show(els.menu, false); show(els.end, false);
  show(els.hud, true); show(els.skills, true);
  updateP2HudVisibility();
  showChapter();
}

function showChapter() {
  state = 'chapter';
  const s = SCENES[sceneIdx % SCENES.length];
  els.chapterTitle.textContent = endless && sceneIdx >= SCENES.length ? ('无尽 · ' + s.name) : s.name;
  els.chapterText.textContent = endless && sceneIdx >= SCENES.length
    ? '契已送达，债未算清。他说：那就绕着我，一直走下去。' : s.story;
  show(els.chapter, true);
}

function beginWave() {
  show(els.chapter, false);
  state = 'playing';
  const s = SCENES[sceneIdx % SCENES.length];
  const w = s.waves[waveIdx];
  spawnQueue = [];
  if (w.boss) { spawnBoss(); waveActive = true; return; }
  ['chaser', 'dart', 'tank', 'lurker'].forEach(t => {
    for (let i = 0; i < (w[t] || 0); i++) spawnQueue.push(t);
  });
  for (let i = spawnQueue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spawnQueue[i], spawnQueue[j]] = [spawnQueue[j], spawnQueue[i]]; }
  spawnTimer = 0.5; waveActive = true;
}

function waveCleared() {
  waveActive = false;
  const s = SCENES[sceneIdx % SCENES.length];
  if (bossRef) return;
  waveIdx++;
  if (waveIdx >= s.waves.length) {
    sceneIdx++; waveIdx = 0;
    if (!endless && sceneIdx >= SCENES.length) return victory();
    return showChapter();
  }
  if (!endless && !puzzleDone[sceneIdx % SCENES.length] && waveIdx === PUZZLE_AT[sceneIdx % SCENES.length]) {
    startPuzzle(sceneIdx % SCENES.length);
  } else {
    openUpgrade();
  }
}

function openUpgrade() {
  state = 'upgrade';
  const box = $('upgrade-cards'); box.innerHTML = '';
  const pool = [...UPGRADES].sort(() => Math.random() - 0.5).slice(0, 3);
  pool.forEach(u => {
    const b = document.createElement('button');
    b.className = 'up-card';
    b.innerHTML = '<div class="up-name">' + u.name + '</div><div class="up-desc">' + u.desc + '</div>';
    b.onclick = () => {
      players.forEach(pl => u.apply(pl));
      beep(392, 0.14, 'triangle', 0.05);
      show(els.upgrade, false); beginWave();
    };
    box.appendChild(b);
  });
  show(els.upgrade, true);
}

function gameOver() {
  state = 'over';
  els.endTitle.textContent = '你们留在了那边';
  els.endStats.textContent = statsText('走廊的灯全灭了。契，从手里飘了出去。');
  show(els.end, true); show(els.skills, false);
  saveBest(false);
}

function victory() {
  state = 'win';
  localStorage.setItem('td_won', '1');
  els.endTitle.textContent = '契已送达 · 债已清';
  els.endStats.textContent = statsText('他收下契，在末页盖了印。无尽模式已解锁。');
  show(els.end, true); show(els.skills, false);
  saveBest(true);
  refreshBest();
}

function statsText(tip) {
  return tip + '\n时尘 ' + score + ' · 封印 ' + seals + ' 次 · 击破 ' + kills + ' · 用时 ' + Math.floor(runTime) + 's\n总借债 ' + debtsTotal + ' 笔 · 亲手销账 ' + debtsRepaid + ' 笔 · 未偿 ' + (debts.length + shadows.length) + ' 笔';
}

function saveBest(won) {
  const prev = JSON.parse(localStorage.getItem('td_best') || 'null');
  if (!prev || score > prev.score) {
    localStorage.setItem('td_best', JSON.stringify({ score, time: Math.floor(runTime), debts: debtsTotal, seals, won }));
  }
}

/* ---------------- 解谜 ---------------- */
function startPuzzle(idx) {
  puzzleDone[idx] = true;
  state = 'playing';
  if (idx === 0) {
    const pts = [];
    const spots = [[0.24, 0.3], [0.76, 0.28], [0.7, 0.74], [0.28, 0.72]];
    spots.forEach(s => pts.push({ x: W * s[0] + rand(-24, 24), y: H * s[1] + rand(-24, 24) }));
    puzzle = { kind: 'sigils', pts, next: 0, showUntil: runTime + 4, timeLeft: 45, label: '' };
    alertText('踏符阵 · 记住符亮起的顺序', 2200);
  } else if (idx === 1) {
    puzzle = { kind: 'twins', timeLeft: 75, label: '' };
    spawnTwin(W * 0.3, H * 0.35); spawnTwin(W * 0.7, H * 0.65);
    alertText('双生祟 · 必须同一道印同时封住两个', 2400);
  } else {
    puzzle = {
      kind: 'riddle', standT: 0, cur: -1, label: '',
      circles: [
        { x: W * 0.22, y: H * 0.66, label: '死去的未来的你', correct: true },
        { x: W * 0.5, y: H * 0.74, label: '三年前的契主', correct: false },
        { x: W * 0.78, y: H * 0.66, label: '时契行掌柜', correct: false }
      ]
    };
    alertText('契文三问 · 站进圈里，停满两息作答', 2400);
  }
}

function endPuzzle(success, msg) {
  puzzle = null;
  if (success) {
    score += 150;
    players.forEach(pl => { if (!pl.downed) pl.hp = Math.min(pl.maxHp, pl.hp + 30); });
    alertText(msg || '谜解开了 · 全队回复 30', 2000);
    beep(523, 0.25, 'triangle', 0.06);
  } else if (msg) {
    alertText(msg, 2200);
  }
  openUpgrade();
}

function spawnTwin(x, y) {
  enemies.push({
    type: 'twin', twin: true, x, y, r: 18, hp: 9999, maxHp: 9999,
    speed: 40, dmg: 10, score: 100, wob: rand(0, 6), mode: 'stalk', modeTimer: 2, shardTick: 0
  });
}

function updatePuzzle(dt) {
  if (!puzzle) return;
  if (puzzle.kind === 'sigils') {
    puzzle.timeLeft -= dt;
    const showing = runTime < puzzle.showUntil;
    puzzle.label = showing ? '踏符阵 · 记顺序！' : ('踏符阵 · 已踏 ' + puzzle.next + ' / 4 · ' + Math.ceil(puzzle.timeLeft) + 's');
    if (!showing) {
      const target = puzzle.pts[puzzle.next];
      let steppedWrong = false;
      alivePlayers().forEach(pl => {
        puzzle.pts.forEach((pt, j) => {
          if (Math.hypot(pl.x - pt.x, pl.y - pt.y) < 32) {
            if (j === puzzle.next) {
              puzzle.next++; beep(660 + puzzle.next * 60, 0.12, 'sine', 0.05);
              burst(pt.x, pt.y, 14, '#ffd76e');
            } else if (j > puzzle.next) steppedWrong = true;
          }
        });
      });
      if (puzzle.next >= 4) { endPuzzle(true, '踏符阵 · 解开了'); return; }
      if (steppedWrong) {
        spawnEnemy('chaser'); spawnEnemy('chaser');
        endPuzzle(false, '顺序错了 · 有东西被惊醒了');
        return;
      }
    }
    if (puzzle.timeLeft <= 0) endPuzzle(false, '符光熄了 · 谜没解开');
  } else if (puzzle.kind === 'twins') {
    puzzle.timeLeft -= dt;
    const twinsAlive = enemies.filter(e => e.twin).length;
    puzzle.label = '双生祟 · 还剩 ' + twinsAlive + ' 个 · 须同印双封 · ' + Math.ceil(puzzle.timeLeft) + 's';
    if (twinsAlive === 0) { score += 100; endPuzzle(true, '双生同封 · 解开了'); return; }
    if (puzzle.timeLeft <= 0) {
      enemies = enemies.filter(e => !e.twin);
      const m = spawnPos();
      const t = { type: 'tank', x: m.x, y: m.y, r: 27, hp: 320, maxHp: 320, speed: 46, dmg: 18, score: 30, wob: 0, mode: 'stalk', modeTimer: 2, shardTick: 0, mergeTank: true };
      enemies.push(t);
      puzzle = { kind: 'twinsMerged', label: '它们合成了一个 · 打碎它' };
      alertText('双生合为一 · 打碎它', 2000);
      return;
    }
  } else if (puzzle.kind === 'twinsMerged') {
    puzzle.label = '打碎合体祟';
    if (!enemies.some(e => e.mergeTank)) { endPuzzle(false, null); return; }
  } else if (puzzle.kind === 'riddle') {
    puzzle.label = '三问：祭坛上等你交契的，是谁？站圈停满两息';
    let inside = -1;
    puzzle.circles.forEach((c, i) => {
      if (alivePlayers().some(pl => Math.hypot(pl.x - c.x, pl.y - c.y) < 46)) inside = i;
    });
    if (inside >= 0) {
      if (puzzle.cur === inside) puzzle.standT += dt; else { puzzle.cur = inside; puzzle.standT = 0; }
      if (puzzle.standT >= 2.2) {
        const c = puzzle.circles[inside];
        if (c.correct) { bossBuff = -1; endPuzzle(true, '答对了 · 他收契的手抖了一下（终局弱化）'); }
        else {
          bossBuff = 1;
          spawnShadow(borrowedSet.size ? [...borrowedSet][0] : 'nova');
          endPuzzle(false, '答错了 · 祭坛的力量涨了一截（终局强化）');
        }
        return;
      }
    } else { puzzle.cur = -1; puzzle.standT = 0; }
  }
}

/* ---------------- 敌人 ---------------- */
const ENEMY_DEF = {
  chaser: { hp: 55,  speed: 88,  r: 15, dmg: 10, score: 10 },
  dart:   { hp: 30,  speed: 172, r: 11, dmg: 8,  score: 14 },
  tank:   { hp: 260, speed: 44,  r: 27, dmg: 18, score: 30 },
  lurker: { hp: 70,  speed: 76,  r: 14, dmg: 14, score: 24 }
};

function spawnPos() {
  const side = Math.floor(rand(0, 4));
  if (side === 0) return { x: rand(0, W), y: -30 };
  if (side === 1) return { x: W + 30, y: rand(0, H) };
  if (side === 2) return { x: rand(0, W), y: H + 30 };
  return { x: -30, y: rand(0, H) };
}

function spawnEnemy(type) {
  const d = ENEMY_DEF[type], p = spawnPos();
  const scale = 1 + sceneIdx * 0.4 + waveIdx * 0.15;
  enemies.push({
    type, x: p.x, y: p.y, r: d.r, hp: d.hp * scale, maxHp: d.hp * scale,
    speed: d.speed * rand(0.9, 1.1), dmg: d.dmg, score: d.score,
    wob: rand(0, Math.PI * 2), mode: 'stalk', modeTimer: rand(1.5, 3), lungeVx: 0, lungeVy: 0, shardTick: 0
  });
}

function spawnShadow(skill) {
  const p = spawnPos();
  const scale = 1 + debtsTotal * 0.06;
  shadows.push({
    skill, x: p.x, y: p.y, r: 17, hp: 110 * scale, maxHp: 110 * scale,
    speed: skill === 'chrono' ? 208 : 116, dmg: 12, castTimer: 2.2,
    paperAngle: 0, telegraph: 0, shardTick: 0, spinUntil: 0
  });
  alertText('它来讨债了', 1700);
  beep(98, 0.4, 'sawtooth', 0.06);
}

function spawnBoss() {
  const skills = borrowedSet.size ? [...borrowedSet] : ['nova'];
  const mult = bossBuff > 0 ? 1.25 : bossBuff < 0 ? 0.72 : 1;
  bossRef = {
    boss: true, x: W / 2, y: -50, r: 42,
    hp: (1700 + skills.length * 300) * mult, maxHp: (1700 + skills.length * 300) * mult,
    speed: 80, dmg: 22, score: 500, skills, skillIdx: 0,
    castTimer: 3.5, paperAngle: 0, papersUntil: 0, phase: 'enter', shardTick: 0
  };
  enemies.push(bossRef);
}

/* ---------------- 借命三咒 ---------------- */
function borrow(pl, skill, btn) {
  if (state !== 'playing' || !pl || pl.downed) return;
  if (pl.skillCd[skill] > 0) return;
  pl.skillCd[skill] = SKILL_CD[skill];
  debts.push({ skill, due: DEBT_DELAY });
  debtsTotal++;
  borrowedSet.add(skill); borrowedHistory.push(skill);
  if (btn) { btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash'); }

  if (skill === 'nova') {
    ring(pl.x, pl.y, 195, '#ff6a5e');
    enemies.slice().forEach(e => { if (dist2(e, pl) < 195 * 195) hurtEnemy(e, 100, pl, false); });
    shadows.slice().forEach(s => { if (dist2(s, pl) < 195 * 195) hurtShadow(s, 100); });
    shake = 9; beep(70, 0.4, 'sawtooth', 0.07);
  } else if (skill === 'blades') {
    pl.paperTimer = 8; beep(330, 0.18, 'triangle', 0.05);
  } else if (skill === 'chrono') {
    slowTimer = 5; beep(587, 0.3, 'sine', 0.05);
  }
  burst(pl.x, pl.y, 10, '#ff6a5e');
}

function hurtEnemy(e, dmg, from, viaSeal) {
  if (e.twin && !viaSeal) { /* 双生祟免疫一切非封印伤害 */
    if (!e._hintT || runTime - e._hintT > 2.5) { e._hintT = runTime; alertText('双生不可分 · 只能同印双封', 1300); }
    return;
  }
  e.hp -= dmg;
  if (from) { e.x += (e.x - from.x) * 0.012; e.y += (e.y - from.y) * 0.012; }
  burst(e.x, e.y, 3, '#e6e1d5');
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  const i = enemies.indexOf(e); if (i < 0) return;
  enemies.splice(i, 1);
  kills++; score += e.score;
  burst(e.x, e.y, 16, SCENES[sceneIdx % SCENES.length].accent);
  beep(147, 0.12, 'square', 0.03);
  if (Math.random() < 0.55) drops.push({ x: e.x, y: e.y, kind: 'xp', v: 5 });
  if (Math.random() < 0.07) drops.push({ x: e.x + 8, y: e.y, kind: 'heart', v: 18 });
  if (e.boss) { bossRef = null; score += 400; onBossDown(); }
}

function hurtShadow(s, dmg) {
  s.hp -= dmg;
  burst(s.x, s.y, 3, '#ff8fa3');
  if (s.hp <= 0) {
    const i = shadows.indexOf(s); if (i < 0) return;
    shadows.splice(i, 1);
    kills++; debtsRepaid++; score += 60;
    burst(s.x, s.y, 22, '#ff8fa3');
    drops.push({ x: s.x, y: s.y, kind: 'heart', v: 12 });
    beep(262, 0.16, 'triangle', 0.05);
  }
}

function onBossDown() {
  if (endless) { sceneIdx++; waveIdx = 0; showChapter(); }
  else victory();
}

/* ---------------- 朱砂封印 ---------------- */
function trySeal(pl, poly) {
  const twinsIn = enemies.filter(e => e.twin && pointInPoly(e.x, e.y, poly));
  const crit = Math.random() < pl.crit;
  let dmg = pl.sealDmg * (crit ? 2 : 1);
  if (pl.chainSeal && pl.sealBuffTimer > 0) dmg *= 1.6;
  let hit = 0;
  enemies.slice().forEach(e => {
    if (!pointInPoly(e.x, e.y, poly)) return;
    if (e.twin && twinsIn.length < 2) return; /* 只圈住一个双生：封不住 */
    hurtEnemy(e, e.boss ? dmg * 0.6 : (e.twin ? 99999 : dmg), null, true);
    hit++;
  });
  shadows.slice().forEach(s => { if (pointInPoly(s.x, s.y, poly)) { hurtShadow(s, dmg); hit++; } });
  /* 救援：圈住倒地的队友，把他从那边拉回来 */
  players.forEach(o => {
    if (o.downed && pointInPoly(o.x, o.y, poly)) {
      o.downed = false; o.hp = Math.floor(o.maxHp * 0.5); o.invuln = 1;
      score += 100; burst(o.x, o.y, 26, '#37e0c8');
      alertText('把他从那边拉回来了', 1600);
      beep(523, 0.2, 'triangle', 0.06);
    }
  });
  seals++;
  if (pl.chainSeal) pl.sealBuffTimer = 3;
  score += hit * 15 + Math.floor(polyArea(poly) / 600);
  sealFx.push({ poly, t: 0, crit });
  shake = Math.max(shake, hit ? 5 : 2);
  beep(crit ? 196 : 262, 0.2, 'triangle', 0.06);
  const c = centroid(poly);
  burst(c.x, c.y, hit ? 22 : 8, crit ? '#ffd76e' : '#ff4b3e');
}

function updateTrail(pl, dt) {
  pl.trail.forEach(p => { p.age += dt; });
  pl.trail = pl.trail.filter(p => p.age < pl.trailLife);
  if (pl.downed) { pl.trail = []; return; }
  const last = pl.trail[pl.trail.length - 1];
  if (!last || Math.hypot(pl.x - last.x, pl.y - last.y) >= 13) {
    pl.trail.push({ x: pl.x, y: pl.y, age: 0 });
    if (pl.trail.length > 300) pl.trail.shift();
    for (let i = 0; i < pl.trail.length - 22; i++) {
      const p = pl.trail[i];
      if (Math.hypot(pl.x - p.x, pl.y - p.y) < 26) {
        const poly = pl.trail.slice(i);
        if (polyArea(poly) > 3200) { trySeal(pl, poly); pl.trail = []; }
        break;
      }
    }
  }
}

/* ---------------- 伤害与倒地 ---------------- */
function damagePlayer(pl, dmg) {
  if (!pl || pl.downed || pl.invuln > 0 || state !== 'playing') return;
  pl.hp -= dmg; pl.invuln = 0.55; shake = Math.max(shake, 5);
  burst(pl.x, pl.y, 8, '#ff5d7a');
  beep(82, 0.16, 'sawtooth', 0.06);
  if (pl.hp <= 0) {
    pl.hp = 0;
    const partnerAlive = players.some(o => o !== pl && !o.downed);
    if (partnerAlive) {
      pl.downed = true; pl.reviveTimer = 35; pl.trail = [];
      alertText('同行者倒下了 · 绕着他合印，把他拉回来', 2400);
    } else {
      gameOver();
    }
  }
}

/* ---------------- 粒子 ---------------- */
function burst(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(40, 220);
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.6), t: 0, color, r: rand(1.5, 3.5) });
  }
}
function ring(x, y, r, color) { rings.push({ x, y, r, color, t: 0 }); }

/* ---------------- 输入 ---------------- */
function isGuest() { return window.TDNet && TDNet.role === 'guest'; }
function isHost() { return window.TDNet && TDNet.role === 'host'; }

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (isGuest()) {
    if (e.code === 'KeyJ') TDNet.send({ t: 'act', a: 'nova' });
    if (e.code === 'KeyK') TDNet.send({ t: 'act', a: 'blades' });
    if (e.code === 'KeyL') TDNet.send({ t: 'act', a: 'chrono' });
    if (e.code === 'Space') TDNet.send({ t: 'act', a: 'dash' });
    return;
  }
  if (e.code === 'KeyJ') borrow(player, 'nova', document.querySelector('[data-skill="nova"]'));
  if (e.code === 'KeyK') borrow(player, 'blades', document.querySelector('[data-skill="blades"]'));
  if (e.code === 'KeyL') borrow(player, 'chrono', document.querySelector('[data-skill="chrono"]'));
  if (e.code === 'Enter' && state === 'playing' && !isHost() && players.length < 2) {
    addPlayer('local2');
    alertText('同行者加入 · P2：方向键移动，小键盘 1/2/3 借咒，右 Shift 冲刺', 2600);
  }
  const p2 = players.find(p => p.kind === 'local2');
  if (p2) {
    if (e.code === 'Numpad1' || e.code === 'Comma') borrow(p2, 'nova', null);
    if (e.code === 'Numpad2' || e.code === 'Period') borrow(p2, 'blades', null);
    if (e.code === 'Numpad3' || e.code === 'Slash') borrow(p2, 'chrono', null);
    if (e.code === 'ShiftRight') tryDash(p2);
  }
  if (e.code === 'Escape' && state === 'playing') pauseGame();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

document.querySelectorAll('.skill-btn[data-skill]').forEach(b => {
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (isGuest()) { TDNet.send({ t: 'act', a: b.dataset.skill }); return; }
    borrow(player, b.dataset.skill, b);
  });
});
$('btn-dash').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (isGuest()) { TDNet.send({ t: 'act', a: 'dash' }); return; }
  tryDash(player);
});

canvas.addEventListener('touchstart', handleTouch, { passive: false });
canvas.addEventListener('touchmove', handleTouch, { passive: false });
canvas.addEventListener('touchend', endTouch, { passive: false });
function handleTouch(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.clientX < W * 0.55) {
      if (!joy.active) { joy.active = true; joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY; joy.dx = 0; joy.dy = 0; }
      else if (t.identifier === joy.id) {
        const dx = t.clientX - joy.ox, dy = t.clientY - joy.oy, m = Math.hypot(dx, dy) || 1, cap = Math.min(m, 60);
        joy.dx = dx / m * (cap / 60); joy.dy = dy / m * (cap / 60);
      }
    }
  }
}
function endTouch(e) {
  for (const t of e.changedTouches) if (t.identifier === joy.id) { joy.active = false; joy.dx = 0; joy.dy = 0; }
}

function tryDash(pl) {
  if (state !== 'playing' || !pl || pl.downed || pl.dashCd > 0) return;
  pl.dashTimer = 0.16; pl.dashCd = pl.dashCdMax; pl.invuln = Math.max(pl.invuln, 0.2);
  /* v0.3.1：冲刺不再清掉已有轨迹（玩家反馈原「冲刺断印」设计，改） */
  beep(349, 0.09, 'sine', 0.04);
}

/* ---------------- 按钮与联机菜单 ---------------- */
$('btn-start').onclick = () => startRun(false);
els.endlessBtn.onclick = () => startRun(true);
$('btn-chapter').onclick = () => { if (!isGuest()) beginWave(); };
$('btn-retry').onclick = () => startRun(endless);
$('btn-tomenu').onclick = () => location.reload();
$('btn-pause').onclick = () => pauseGame();
$('btn-resume').onclick = () => { show(els.pause, false); state = 'playing'; };
$('btn-quit').onclick = () => location.reload();
$('btn-mute').onclick = e => { muted = !muted; e.target.textContent = muted ? '×' : '♪'; };
function pauseGame() { if (state !== 'playing' || isGuest()) return; state = 'paused'; show(els.pause, true); }

if (window.TDNet) {
  TDNet.onStatus = s => { els.netStatus.textContent = s; };
  $('btn-host').onclick = () => TDNet.host();
  $('btn-join').onclick = () => TDNet.join($('room-input').value);
  TDNet.onPeerJoin = () => {
    if (state === 'menu') { /* 等房主开局，resetRun 会自动给客人留席 */ }
    else if (players.length < 2 && (state === 'playing' || state === 'chapter')) addPlayer('remote');
  };
  TDNet.onPeerLeave = () => {
    if (isHost()) {
      const rp = players.find(p => p.kind === 'remote');
      if (rp) { players = players.filter(p => p !== rp); updateP2HudVisibility(); alertText('同行者离开了', 1800); }
    }
  };
}

/* ---------------- 主循环 ---------------- */
let lastTs = 0, snapTimer = 0, guestInputTimer = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min((ts - lastTs) / 1000 || 0, 0.05);
  lastTs = ts;
  if (isGuest()) {
    cosmetic(dt);
    guestInputTimer -= dt;
    if (guestInputTimer <= 0) { guestInputTimer = 0.07; sendGuestInput(); }
    render();
    return;
  }
  if (state === 'playing') update(dt);
  if (isHost() && TDNet.conn && TDNet.conn.open) {
    snapTimer -= dt;
    if (snapTimer <= 0) { snapTimer = 0.085; TDNet.send({ t: 'state', s: snapshot() }); }
  }
  render();
}
requestAnimationFrame(loop);

function cosmetic(dt) {
  parts = parts.filter(p => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.t < p.life; });
  rings = rings.filter(r => { r.t += dt * 2.4; return r.t < 1; });
  sealFx = sealFx.filter(f => { f.t += dt * 2; return f.t < 1; });
}

function enemyTimeScale() { return slowTimer > 0 ? 0.38 : 1; }

function readLocalInput(pl) {
  let mx = 0, my = 0;
  const hasLocal2 = players.some(p => p.kind === 'local2');
  if (pl.kind === 'local1') {
    if (keys.KeyW) my -= 1;
    if (keys.KeyS) my += 1;
    if (keys.KeyA) mx -= 1;
    if (keys.KeyD) mx += 1;
    if (!hasLocal2) {
      if (keys.ArrowUp) my -= 1;
      if (keys.ArrowDown) my += 1;
      if (keys.ArrowLeft) mx -= 1;
      if (keys.ArrowRight) mx += 1;
    }
    if (joy.active) { mx += joy.dx; my += joy.dy; }
  } else if (pl.kind === 'local2') {
    if (keys.ArrowUp) my -= 1;
    if (keys.ArrowDown) my += 1;
    if (keys.ArrowLeft) mx -= 1;
    if (keys.ArrowRight) mx += 1;
  }
  return { mx, my };
}

function updatePlayer(pl, dt) {
  if (pl.downed) {
    pl.reviveTimer -= dt;
    if (pl.reviveTimer <= 0) { gameOver(); }
    return;
  }
  let inp;
  if (pl.kind === 'remote') {
    inp = TDNet.guestInput;
    while (TDNet.guestBorrow.length) borrow(pl, TDNet.guestBorrow.shift(), null);
    if (TDNet.guestDash) { TDNet.guestDash = false; tryDash(pl); }
  } else {
    inp = readLocalInput(pl);
  }
  let mx = inp.mx || 0, my = inp.my || 0;
  const mm = Math.hypot(mx, my);
  if (mm > 1) { mx /= mm; my /= mm; }
  if (pl.kind === 'local1' && keys.Space) tryDash(pl);
  let spd = pl.speed * (slowTimer > 0 ? 1.18 : 1);
  if (pl.boostTimer > 0) { pl.boostTimer -= dt; spd *= 1.45; }
  if (pl.dashTimer > 0) { pl.dashTimer -= dt; spd *= 3.1; if (pl.dashBoost && pl.dashTimer <= 0) pl.boostTimer = 0.5; }
  pl.x = clamp(pl.x + mx * spd * dt, pl.r, W - pl.r);
  pl.y = clamp(pl.y + my * spd * dt, pl.r, H - pl.r);
  if (mx !== 0) pl.face = mx > 0 ? 1 : -1;
  if (pl.dashCd > 0) pl.dashCd -= dt;
  if (pl.invuln > 0) pl.invuln -= dt;
  if (pl.sealBuffTimer > 0) pl.sealBuffTimer -= dt;
  for (const k in pl.skillCd) if (pl.skillCd[k] > 0) pl.skillCd[k] -= dt;
  if (pl.paperTimer > 0) { pl.paperTimer -= dt; pl.paperAngle += dt * 4.4; }
  updateTrail(pl, dt);

  if (pl.paperTimer > 0) {
    for (let i = 0; i < 3; i++) {
      const a = pl.paperAngle + i * (Math.PI * 2 / 3);
      const bx = pl.x + Math.cos(a) * 52, by = pl.y + Math.sin(a) * 52;
      enemies.slice().forEach(e => { if (dist2(e, { x: bx, y: by }) < (e.r + 13) * (e.r + 13) && (e.shardTick || 0) <= 0) { e.shardTick = 0.22; hurtEnemy(e, 26, pl, false); } });
      shadows.slice().forEach(s => { if (dist2(s, { x: bx, y: by }) < (s.r + 13) * (s.r + 13) && (s.shardTick || 0) <= 0) { s.shardTick = 0.22; hurtShadow(s, 26); } });
    }
  }
}

function update(dt) {
  runTime += dt;
  const ts = enemyTimeScale();
  if (slowTimer > 0) slowTimer -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 26);

  for (let i = debts.length - 1; i >= 0; i--) {
    debts[i].due -= dt;
    if (debts[i].due <= 0) { const d = debts.splice(i, 1)[0]; spawnShadow(d.skill); }
  }

  players.slice().forEach(pl => updatePlayer(pl, dt));
  enemies.forEach(e => { if (e.shardTick > 0) e.shardTick -= dt; });
  shadows.forEach(s => { if (s.shardTick > 0) s.shardTick -= dt; });

  if (spawnQueue.length) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = 0.55; spawnEnemy(spawnQueue.shift()); }
  }

  const edt = dt * ts;
  enemies.slice().forEach(e => updateEnemy(e, edt, dt));
  shadows.slice().forEach(s => updateShadow(s, edt, dt));
  updatePuzzle(dt);

  ebullets = ebullets.filter(b => {
    b.x += b.vx * edt; b.y += b.vy * edt; b.life -= dt;
    if (b.life <= 0) return false;
    const tp = nearestPlayer(b.x, b.y);
    if (tp && tp.invuln <= 0 && dist2(b, tp) < (tp.r + 5) * (tp.r + 5)) { damagePlayer(tp, b.dmg); return false; }
    return true;
  });

  drops = drops.filter(d => {
    let consumed = false;
    alivePlayers().forEach(pl => {
      if (consumed) return;
      const dd = Math.sqrt(dist2(d, pl));
      if (dd < pl.magnet) { d.x += (pl.x - d.x) * dt * 7; d.y += (pl.y - d.y) * dt * 7; }
      if (dd < pl.r + 10) {
        if (d.kind === 'xp') { score += d.v; beep(784, 0.05, 'sine', 0.02); }
        else { pl.hp = Math.min(pl.maxHp, pl.hp + d.v); beep(440, 0.09, 'sine', 0.04); }
        consumed = true;
      }
    });
    return !consumed;
  });

  cosmetic(dt);
  if (waveActive && !spawnQueue.length && !enemies.length && !shadows.length) waveCleared();
  updateHud();
}

function updateEnemy(e, edt, rawDt) {
  if (e.boss) return updateBoss(e, edt, rawDt);
  const tp = nearestPlayer(e.x, e.y);
  if (!tp) return;
  const a = Math.atan2(tp.y - e.y, tp.x - e.x);
  e.wob += rawDt * 3;
  if (e.twin) { /* 双生祟：彼此排斥、远远绕着人飘 */
    const other = enemies.find(o => o.twin && o !== e);
    let ax = Math.cos(a + Math.PI / 2) * 0.6, ay = Math.sin(a + Math.PI / 2) * 0.6;
    if (other) {
      const d = Math.hypot(e.x - other.x, e.y - other.y) || 1;
      if (d < 260) { ax += (e.x - other.x) / d; ay += (e.y - other.y) / d; }
    }
    e.x += ax * e.speed * edt; e.y += ay * e.speed * edt;
    e.x = clamp(e.x, 30, W - 30); e.y = clamp(e.y, 30, H - 30);
  } else if (e.type === 'lurker') {
    e.modeTimer -= rawDt;
    if (e.mode === 'stalk') {
      e.x += Math.cos(a) * e.speed * edt; e.y += Math.sin(a) * e.speed * edt;
      if (e.modeTimer <= 0 && Math.sqrt(dist2(e, tp)) < 300) { e.mode = 'aim'; e.modeTimer = 0.6; }
    } else if (e.mode === 'aim') {
      if (e.modeTimer <= 0) {
        e.mode = 'lunge'; e.modeTimer = 0.34;
        e.lungeVx = Math.cos(a) * 540; e.lungeVy = Math.sin(a) * 540;
        beep(587, 0.1, 'sawtooth', 0.04);
      }
    } else if (e.mode === 'lunge') {
      e.x += e.lungeVx * edt; e.y += e.lungeVy * edt;
      if (e.modeTimer <= 0) { e.mode = 'stalk'; e.modeTimer = rand(2, 3.4); }
    }
  } else if (e.type === 'dart') {
    e.x += Math.cos(a + Math.sin(e.wob) * 0.5) * e.speed * edt;
    e.y += Math.sin(a + Math.sin(e.wob) * 0.5) * e.speed * edt;
  } else {
    e.x += Math.cos(a) * e.speed * edt; e.y += Math.sin(a) * e.speed * edt;
  }
  if (tp.invuln <= 0 && dist2(e, tp) < (e.r + tp.r) * (e.r + tp.r)) {
    damagePlayer(tp, e.dmg);
    e.x -= Math.cos(a) * 26; e.y -= Math.sin(a) * 26;
  }
}

function updateShadow(s, edt, rawDt) {
  const tp = nearestPlayer(s.x, s.y);
  if (!tp) return;
  const a = Math.atan2(tp.y - s.y, tp.x - s.x);
  const effDt = s.skill === 'chrono' ? rawDt : edt;
  s.x += Math.cos(a) * s.speed * effDt; s.y += Math.sin(a) * s.speed * effDt;
  s.castTimer -= effDt;
  if (s.skill === 'blades') {
    s.paperAngle += effDt * 4.4;
    const rad = runTime < s.spinUntil ? 62 : 46;
    for (let i = 0; i < 3; i++) {
      const ba = s.paperAngle + i * (Math.PI * 2 / 3);
      const bx = s.x + Math.cos(ba) * rad, by = s.y + Math.sin(ba) * rad;
      alivePlayers().forEach(pl => {
        if (pl.invuln <= 0 && dist2(pl, { x: bx, y: by }) < (pl.r + 12) * (pl.r + 12)) damagePlayer(pl, 14);
      });
    }
  }
  if (s.castTimer <= 0) {
    if (s.skill === 'nova') {
      s.castTimer = 3.4; s.telegraph = 0.7;
      setTimeout(() => {
        if (state !== 'playing' || !shadows.includes(s)) return;
        ring(s.x, s.y, 130, '#ff5d7a');
        alivePlayers().forEach(pl => { if (pl.invuln <= 0 && dist2(pl, s) < 130 * 130) damagePlayer(pl, 20); });
      }, 700);
    } else if (s.skill === 'chrono') {
      s.castTimer = 4;
      s.x += Math.cos(a) * 130; s.y += Math.sin(a) * 130;
      burst(s.x, s.y, 8, '#8cdcff');
    } else {
      s.castTimer = 3.2; s.spinUntil = runTime + 1.6;
    }
  }
  if (tp.invuln <= 0 && dist2(s, tp) < (s.r + tp.r) * (s.r + tp.r)) {
    damagePlayer(tp, s.dmg);
    s.x -= Math.cos(a) * 30; s.y -= Math.sin(a) * 30;
  }
}

function updateBoss(e, edt, rawDt) {
  if (e.phase === 'enter') { e.y += 86 * rawDt; if (e.y >= 112) e.phase = 'fight'; return; }
  const tp = nearestPlayer(e.x, e.y);
  if (!tp) return;
  const a = Math.atan2(tp.y - e.y, tp.x - e.x);
  e.x += Math.cos(a) * e.speed * edt; e.y += Math.sin(a) * e.speed * edt;
  e.castTimer -= rawDt;
  if (e.castTimer <= 0) {
    const skill = e.skills[e.skillIdx % e.skills.length];
    e.skillIdx++; e.castTimer = 4.2;
    if (skill === 'nova') {
      ring(e.x, e.y, 170, '#ff5d7a');
      for (let i = 0; i < 14; i++) {
        const ba = (i / 14) * Math.PI * 2;
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(ba) * 185, vy: Math.sin(ba) * 185, dmg: 12, life: 3 });
      }
    } else if (skill === 'blades') {
      e.papersUntil = runTime + 6;
    } else if (skill === 'chrono') {
      e.x += Math.cos(a) * 175; e.y += Math.sin(a) * 175;
      burst(e.x, e.y, 16, '#8cdcff');
    }
    beep(110, 0.3, 'sawtooth', 0.05);
  }
  if (e.papersUntil && runTime < e.papersUntil) {
    e.paperAngle += rawDt * 4.6;
    for (let i = 0; i < 4; i++) {
      const ba = e.paperAngle + i * (Math.PI / 2);
      const bx = e.x + Math.cos(ba) * 76, by = e.y + Math.sin(ba) * 76;
      alivePlayers().forEach(pl => { if (pl.invuln <= 0 && dist2(pl, { x: bx, y: by }) < (pl.r + 14) * (pl.r + 14)) damagePlayer(pl, 16); });
    }
  }
  if (tp.invuln <= 0 && dist2(e, tp) < (e.r + tp.r) * (e.r + tp.r)) {
    damagePlayer(tp, e.dmg);
    tp.x -= Math.cos(a) * 34; tp.y -= Math.sin(a) * 34;
  }
}

/* ---------------- 联机：快照与客人端 ---------------- */
function snapshot() {
  return {
    st: state, sc: sceneIdx, wv: waveIdx, endless,
    score, kills, seals, runTime: Math.floor(runTime),
    debtN: debts.length + shadows.length,
    chapter: { title: els.chapterTitle.textContent, text: els.chapterText.textContent },
    end: { title: els.endTitle.textContent, stats: els.endStats.textContent },
    pz: puzzle ? {
      kind: puzzle.kind, label: puzzle.label || '',
      pts: puzzle.pts || null, next: puzzle.next || 0, showNums: puzzle.kind === 'sigils' && runTime < puzzle.showUntil,
      circles: puzzle.circles || null, standT: puzzle.standT || 0, cur: puzzle.cur === undefined ? -1 : puzzle.cur
    } : null,
    players: players.map(pl => ({
      x: Math.round(pl.x), y: Math.round(pl.y), hp: Math.ceil(pl.hp), maxHp: pl.maxHp,
      downed: pl.downed, face: pl.face, paperTimer: pl.paperTimer > 0 ? 1 : 0, paperAngle: pl.paperAngle,
      reviveTimer: Math.ceil(pl.reviveTimer || 0),
      trail: pl.trail.filter((_, i) => i % 2 === 0).map(p => [Math.round(p.x), Math.round(p.y)]),
      skillCd: { nova: Math.max(0, pl.skillCd.nova), blades: Math.max(0, pl.skillCd.blades), chrono: Math.max(0, pl.skillCd.chrono) },
      dashCd: Math.max(0, pl.dashCd), dashCdMax: pl.dashCdMax
    })),
    enemies: enemies.map(e => ({ x: Math.round(e.x), y: Math.round(e.y), r: e.r, hp: e.hp, maxHp: e.maxHp, type: e.type, boss: !!e.boss, twin: !!e.twin, mode: e.mode })),
    shadows: shadows.map(s => ({ x: Math.round(s.x), y: Math.round(s.y), r: s.r, hp: s.hp, maxHp: s.maxHp, skill: s.skill, paperAngle: s.paperAngle, spinUntil: s.spinUntil, telegraph: s.telegraph })),
    drops: drops.map(d => ({ x: Math.round(d.x), y: Math.round(d.y), kind: d.kind })),
    ebullets: ebullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y) })),
    sealFx: sealFx.map(f => ({ poly: f.poly, crit: f.crit, t: f.t }))
  };
}

function ensureGuestPlayers(n) {
  while (players.length < n) { const p = newPlayer(players.length === 0 ? 'local1' : 'remote', players.length); players.push(p); }
  if (players.length > n) players = players.slice(0, n);
  player = players[0];
  updateP2HudVisibility();
}

function applySnapshot(s) {
  const prevState = state;
  state = s.st; sceneIdx = s.sc; waveIdx = s.wv; endless = s.endless;
  score = s.score; kills = s.kills; seals = s.seals; runTime = s.runTime;
  ensureGuestPlayers(s.players.length);
  s.players.forEach((sp, i) => {
    const pl = players[i];
    Object.assign(pl, {
      x: sp.x, y: sp.y, hp: sp.hp, maxHp: sp.maxHp, downed: sp.downed, face: sp.face,
      paperTimer: sp.paperTimer, paperAngle: sp.paperAngle, reviveTimer: sp.reviveTimer,
      skillCd: sp.skillCd, dashCd: sp.dashCd, dashCdMax: sp.dashCdMax
    });
    pl.trail = sp.trail.map(p => ({ x: p[0], y: p[1], age: 0 }));
  });
  updateHud._debtN = s.debtN;
  enemies = s.enemies; shadows = s.shadows; drops = s.drops;
  ebullets = s.ebullets.map(b => ({ x: b.x, y: b.y }));
  sealFx = s.sealFx;
  puzzle = s.pz;
  bossRef = enemies.find(e => e.boss) || null;
  show(els.menu, state === 'menu');
  show(els.hud, state !== 'menu'); show(els.skills, state === 'playing');
  if (state === 'chapter') {
    els.chapterTitle.textContent = s.chapter.title;
    els.chapterText.textContent = s.chapter.text + '\n（等房主进入）';
    show(els.chapter, true);
  } else show(els.chapter, false);
  show(els.upgrade, state === 'upgrade');
  if (state === 'upgrade') $('upgrade-cards').innerHTML = '<p style="opacity:.85;line-height:1.9">房主正在凝形……<br>升级对全队生效</p>';
  if (state === 'over' || state === 'win') {
    els.endTitle.textContent = s.end.title; els.endStats.textContent = s.end.stats;
    show(els.end, true);
  } else show(els.end, false);
  if (state !== prevState && state === 'playing') show(els.chapter, false);
  updateHud();
}

function sendGuestInput() {
  const me = viewPl();
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (joy.active) { mx += joy.dx; my += joy.dy; }
  TDNet.send({ t: 'input', mx, my });
  void me;
}

if (window.TDNet) {
  TDNet.onMsg = d => {
    if (isHost()) {
      if (d.t === 'input') TDNet.guestInput = { mx: clamp(d.mx || 0, -1, 1), my: clamp(d.my || 0, -1, 1) };
      else if (d.t === 'act') {
        if (d.a === 'dash') TDNet.guestDash = true;
        else TDNet.guestBorrow.push(d.a);
      }
    } else if (isGuest()) {
      if (d.t === 'state') applySnapshot(d.s);
    }
  };
}

/* ---------------- HUD ---------------- */
const skillBtns = {};
document.querySelectorAll('.skill-btn[data-skill]').forEach(b => { skillBtns[b.dataset.skill] = b; });
function updateHud() {
  if (!players.length) return;
  const me = viewPl(); if (!me) return;
  const scene = SCENES[sceneIdx % SCENES.length];
  els.hpFill.style.width = (me.hp / me.maxHp * 100) + '%';
  els.hpText.textContent = (me.downed ? '倒地 ' + Math.ceil(me.reviveTimer) + 's · ' : '') + Math.ceil(me.hp) + ' / ' + me.maxHp;
  if (players.length > 1) {
    const other = players.find(p => p !== me);
    els.p2fill.style.width = (other.hp / other.maxHp * 100) + '%';
    els.p2text.textContent = '同行 ' + (other.downed ? '倒地 ' + Math.ceil(other.reviveTimer) + 's' : Math.ceil(other.hp) + ' / ' + other.maxHp);
  }
  els.scene.textContent = (endless && sceneIdx >= SCENES.length ? '无尽 · ' : '') + scene.name;
  if (puzzle && puzzle.label) els.wave.textContent = puzzle.label;
  else {
    const w = scene.waves[waveIdx];
    els.wave.textContent = w && w.boss ? '最终讨债' : ('第 ' + (waveIdx + 1) + ' / ' + scene.waves.length + ' 波 · 余祟 ' + (enemies.length + shadows.length + spawnQueue.length));
  }
  els.debtCount.textContent = isGuest() ? (updateHud._debtN || 0) : (debts.length + shadows.length);
  els.scoreCount.textContent = score;
  for (const k in skillBtns) {
    const cd = skillBtns[k].querySelector('.sk-cd');
    const remain = Math.max(0, me.skillCd[k]);
    cd.style.width = (remain / SKILL_CD[k] * 100) + '%';
    skillBtns[k].style.opacity = remain > 0 ? 0.55 : 1;
  }
  const dashBtn = $('btn-dash');
  dashBtn.querySelector('.sk-cd').style.width = (Math.max(0, me.dashCd) / (me.dashCdMax || 2.6) * 100) + '%';
  dashBtn.style.opacity = me.dashCd > 0 ? 0.55 : 1;
}

/* ---------------- 渲染 ---------------- */
let decor = [];
for (let i = 0; i < 80; i++) decor.push({ x: Math.random(), y: Math.random(), r: rand(0.6, 2.2), p: rand(0, 9) });

function render() {
  const scene = SCENES[sceneIdx % SCENES.length];
  const t = performance.now() / 1000;
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, scene.top); g.addColorStop(1, scene.bottom);
  ctx.fillStyle = g; ctx.fillRect(-12, -12, W + 24, H + 24);

  if (scene.theme === 'house') {
    ctx.strokeStyle = 'rgba(159,183,255,0.25)'; ctx.lineWidth = 1;
    decor.forEach(d => {
      const y = ((d.y + t * 0.55 * (0.5 + d.r * 0.3)) % 1) * H, x = d.x * W + y * 0.06;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 13); ctx.stroke();
    });
  } else if (scene.theme === 'ward') {
    decor.forEach(d => {
      ctx.fillStyle = 'rgba(180,230,190,0.14)';
      ctx.beginPath(); ctx.arc(d.x * W + Math.sin(t * 0.4 + d.p) * 12, d.y * H, d.r * 1.8, 0, 7); ctx.fill();
    });
    if (Math.sin(t * 1.7) > 0.995 || Math.sin(t * 4.3) > 0.998) { ctx.fillStyle = 'rgba(200,255,210,0.05)'; ctx.fillRect(0, 0, W, H); }
  } else {
    const mg = ctx.createRadialGradient(W * 0.8, H * 0.16, 8, W * 0.8, H * 0.16, 90);
    mg.addColorStop(0, 'rgba(255,90,70,0.85)'); mg.addColorStop(1, 'rgba(255,90,70,0)');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.16, 90, 0, 7); ctx.fill();
    decor.forEach(d => {
      const y = ((d.y - t * 0.02 * d.r) % 1 + 1) % 1 * H;
      ctx.fillStyle = 'rgba(255,120,70,0.32)';
      ctx.beginPath(); ctx.arc(d.x * W + Math.sin(t + d.p) * 8, y, d.r * 1.5, 0, 7); ctx.fill();
    });
  }
  if (slowTimer > 0) { ctx.fillStyle = 'rgba(90,140,255,0.10)'; ctx.fillRect(-12, -12, W + 24, H + 24); }

  drawPuzzle(t);
  if (!players.length) { ctx.restore(); return; }

  /* 双人轨迹：P1 朱砂，P2 青砂 */
  players.forEach(pl => {
    if (pl.trail.length < 2 || pl.downed) return;
    const main = pl.idx === 0 ? '255,84,66' : '55,224,200';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      pl.trail.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.strokeStyle = 'rgba(' + main + (pass === 0 ? ',0.18)' : ',0.85)');
      ctx.lineWidth = pass === 0 ? 7 : 2.6;
      ctx.stroke();
    }
  });

  sealFx.forEach(f => {
    ctx.globalAlpha = (1 - f.t) * 0.5;
    ctx.fillStyle = f.crit ? '#ffd76e' : '#ff4b3e';
    ctx.beginPath();
    f.poly.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  });

  drops.forEach(d => {
    ctx.fillStyle = d.kind === 'xp' ? '#ffd76e' : '#ff7d9c';
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.PI / 4);
    const s = d.kind === 'xp' ? 5 : 7;
    ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
  });

  enemies.forEach(e => drawEnemy(e, scene));
  shadows.forEach(s => drawShadow(s));
  ebullets.forEach(b => {
    ctx.fillStyle = '#b46bff';
    ctx.beginPath(); ctx.arc(b.x, b.y, 5.5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(b.x, b.y, 2, 0, 7); ctx.fill();
  });

  players.forEach(pl => drawPlayer(pl, t));

  parts.forEach(p => {
    ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  });
  rings.forEach(r => {
    ctx.globalAlpha = 1 - r.t; ctx.strokeStyle = r.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r * r.t, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  });

  /* 提灯视野（以本地视角玩家为心） */
  const vp = viewPl();
  if (vp) {
    const flick = Math.sin(t * 11) * 5 + Math.sin(t * 23.7) * 3;
    const lg = ctx.createRadialGradient(vp.x, vp.y, 60, vp.x, vp.y, 265 + flick);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(0.72, 'rgba(0,0,0,0.18)');
    lg.addColorStop(1, 'rgba(0,0,0,0.66)');
    ctx.fillStyle = lg; ctx.fillRect(-12, -12, W + 24, H + 24);
  }

  if (joy.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(joy.ox, joy.oy, 46, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(joy.ox + joy.dx * 34, joy.oy + joy.dy * 34, 18, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(pl, t) {
  if (pl.paperTimer > 0 && !pl.downed) {
    for (let i = 0; i < 3; i++) {
      const a = pl.paperAngle + i * (Math.PI * 2 / 3);
      drawShard(pl.x + Math.cos(a) * 52, pl.y + Math.sin(a) * 52, '#f2ecd9');
    }
  }
  if (pl.downed) {
    ctx.save(); ctx.translate(pl.x, pl.y);
    ctx.globalAlpha = 0.45 + Math.sin(t * 5) * 0.15;
    ctx.fillStyle = '#9fb7ff';
    ctx.beginPath(); ctx.arc(0, 0, pl.r, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#dfe8ff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('倒地 · ' + Math.ceil(pl.reviveTimer) + 's', 0, -pl.r - 8);
    ctx.restore();
    return;
  }
  const blink = pl.invuln > 0 && Math.floor(t * 16) % 2 === 0;
  if (blink) return;
  ctx.fillStyle = pl.idx === 0 ? '#e9e4d8' : '#c9f4ec';
  ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r, 0, 7); ctx.fill();
  ctx.fillStyle = '#1a1a22';
  ctx.beginPath(); ctx.arc(pl.x + pl.face * 5, pl.y - 2, 5.5, 0, 7); ctx.fill();
  ctx.strokeStyle = pl.idx === 0 ? 'rgba(255,84,66,0.65)' : 'rgba(55,224,200,0.7)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r + 5 + Math.sin(t * 4) * 1.5, 0, 7); ctx.stroke();
  if (pl.idx === 1) {
    ctx.fillStyle = '#37e0c8'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('同行', pl.x, pl.y - pl.r - 8);
  }
}

function drawPuzzle(t) {
  if (!puzzle) return;
  if (puzzle.kind === 'sigils' && puzzle.pts) {
    puzzle.pts.forEach((pt, i) => {
      const done = i < puzzle.next, isNext = i === puzzle.next;
      ctx.save(); ctx.translate(pt.x, pt.y);
      ctx.strokeStyle = done ? 'rgba(255,215,110,0.95)' : isNext ? 'rgba(255,120,100,0.95)' : 'rgba(200,200,220,0.5)';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, 26 + (isNext ? Math.sin(t * 6) * 3 : 0), 0, 7); ctx.stroke();
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-11, -11, 22, 22);
      ctx.restore();
      if (puzzle.showNums || isGuest()) {
        ctx.fillStyle = '#ffe9a8'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(puzzle.showNums ? String(i + 1) : (isNext ? '?' : ''), pt.x, pt.y + 6);
      }
    });
  } else if (puzzle.kind === 'riddle' && puzzle.circles) {
    puzzle.circles.forEach((c, i) => {
      ctx.save();
      ctx.strokeStyle = puzzle.cur === i ? 'rgba(255,215,110,0.95)' : 'rgba(190,200,255,0.55)';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(c.x, c.y, 46, 0, 7); ctx.stroke();
      if (puzzle.cur === i && puzzle.standT) {
        ctx.strokeStyle = '#ffd76e'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(c.x, c.y, 46, -Math.PI / 2, -Math.PI / 2 + (puzzle.standT / 2.2) * Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#eef1ff'; ctx.font = 'bold 14.5px sans-serif'; ctx.textAlign = 'center';
      const label = c.label || '';
      for (let k = 0; k < label.length; k += 5) ctx.fillText(label.slice(k, k + 5), c.x, c.y - 4 + k / 5 * 17);
      ctx.restore();
    });
  }
}

function hpBar(x, y, w, frac, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - w / 2, y, w, 5);
  ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 5);
}

function drawEnemy(e, scene) {
  if (e.boss) {
    ctx.save(); ctx.translate(e.x, e.y);
    ctx.fillStyle = '#12060a';
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#ff8fa3';
    ctx.beginPath(); ctx.arc(-13, -6, 6, 0, 7); ctx.arc(13, -6, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(-14, 10, 28, 3);
    ctx.restore();
    if (e.papersUntil && runTime < e.papersUntil) {
      for (let i = 0; i < 4; i++) {
        const a = e.paperAngle + i * (Math.PI / 2);
        drawShard(e.x + Math.cos(a) * 76, e.y + Math.sin(a) * 76, '#f2ecd9');
      }
    }
    hpBar(e.x, e.y - e.r - 14, 118, e.hp / e.maxHp, '#ff5d7a');
    ctx.fillStyle = '#ffb3c1'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('大讨债影 · 死去的你', e.x, e.y - e.r - 21);
    return;
  }
  if (e.twin) {
    ctx.save(); ctx.translate(e.x, e.y);
    ctx.fillStyle = 'rgba(230,225,213,0.9)';
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#37e0c8'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#14141c';
    ctx.beginPath(); ctx.arc(-5, -3, 2.6, 0, 7); ctx.arc(5, -3, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#b8fff2'; ctx.font = 'bold 10.5px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('双生', 0, e.r + 14);
    ctx.restore();
    return;
  }
  const tp = nearestPlayer(e.x, e.y) || player || { x: e.x + 1, y: e.y };
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = scene.enemy;
  if (e.type === 'tank') {
    ctx.fillRect(-e.r, -e.r, e.r * 2, e.r * 2);
    ctx.strokeStyle = 'rgba(120,20,20,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-e.r, -6); ctx.lineTo(e.r, 2); ctx.moveTo(-e.r, 12); ctx.lineTo(e.r, 6); ctx.stroke();
  } else if (e.type === 'dart') {
    ctx.rotate(Math.atan2(tp.y - e.y, tp.x - e.x));
    ctx.beginPath(); ctx.moveTo(e.r + 4, 0); ctx.lineTo(-e.r, -e.r * 0.7); ctx.lineTo(-e.r, e.r * 0.7); ctx.closePath(); ctx.fill();
  } else if (e.type === 'lurker') {
    if (e.mode === 'aim') { ctx.strokeStyle = '#ff4b3e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r + 6, 0, 7); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(0, 0, e.r + 3, e.r * 0.72, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#7a0f14';
    ctx.beginPath(); ctx.ellipse(e.r * 0.4, 0, 5, e.r * 0.42, 0, 0, 7); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(10,10,14,0.85)';
    ctx.beginPath(); ctx.arc(-4.5, -3, 2.6, 0, 7); ctx.arc(4.5, -3, 2.6, 0, 7); ctx.fill();
  }
  ctx.restore();
  if (e.hp < e.maxHp) hpBar(e.x, e.y - e.r - 9, 30, e.hp / e.maxHp, '#ff8fa3');
}

function drawShadow(s) {
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.fillStyle = 'rgba(14,6,12,0.94)';
  ctx.beginPath(); ctx.arc(0, 0, s.r, 0, 7); ctx.fill();
  ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(SKILL_NAME[s.skill], 0, 4);
  ctx.restore();
  if (s.skill === 'blades') {
    const rad = runTime < s.spinUntil ? 62 : 46;
    for (let i = 0; i < 3; i++) {
      const a = s.paperAngle + i * (Math.PI * 2 / 3);
      drawShard(s.x + Math.cos(a) * rad, s.y + Math.sin(a) * rad, '#f2ecd9');
    }
  }
  if (s.telegraph > 0) {
    s.telegraph -= 0.016;
    ctx.strokeStyle = 'rgba(255,93,122,0.8)';
    ctx.beginPath(); ctx.arc(s.x, s.y, 130, 0, 7); ctx.stroke();
  }
  hpBar(s.x, s.y - s.r - 10, 36, s.hp / s.maxHp, '#ff5d7a');
}

function drawShard(x, y, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(performance.now() / 110);
  ctx.fillStyle = color;
  ctx.fillRect(-4.5, -9, 9, 18);
  ctx.fillStyle = '#c0271f';
  ctx.fillRect(-4.5, -9, 9, 4);
  ctx.restore();
}
