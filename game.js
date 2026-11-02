'use strict';
/* 《明日债 · Tomorrow's Debt》 v0.2.0「凶契」
   v0.2 改版（按玩家反馈）：恐怖主题，废除射击。
   新核心战斗：朱砂绕圈封印——你的移动拖出朱砂轨迹，走满一圈合拢成印，
   圈内的邪祟被封杀。圈越大、圈住的越多，收益越高，风险也越大。
   保留并恐怖化的原创机制：向「死去的未来的自己」借命三咒，
   每借一次，约 22 秒后讨债影带着你借的那一咒来讨债；
   最终 Boss 的咒组 = 你全程借过的咒集合。 */

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

/* ---------------- 音效（低沉合成，无外部文件） ---------------- */
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

/* ---------------- 三幕（恐怖题材各异，一条主线） ---------------- */
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

/* ---------------- 升级池（全部围绕步法与封印） ---------------- */
const UPGRADES = [
  { name: '镇煞契', desc: '封印伤害 +30%', apply: p => { p.sealDmg *= 1.30; } },
  { name: '朱砂契', desc: '朱砂轨迹存留时间 +40%，能绕更大的圈', apply: p => { p.trailLife *= 1.40; } },
  { name: '疾风契', desc: '移动速度 +13%', apply: p => { p.speed *= 1.13; } },
  { name: '扩命契', desc: '生命上限 +25，并回复 40', apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 40); } },
  { name: '破煞契', desc: '封印暴击率 +15%（暴击造成双倍封印伤害）', apply: p => { p.crit += 0.15; } },
  { name: '磁石契', desc: '拾取范围 +70%', apply: p => { p.magnet *= 1.7; } },
  { name: '疾影契', desc: '冲刺冷却 -30%，冲刺后短暂加速', apply: p => { p.dashCdMax *= 0.7; p.dashBoost = true; } },
  { name: '连环契', desc: '每次封印后 3 秒内，下一次封印伤害 +60%', apply: p => { p.chainSeal = true; } }
];

/* ---------------- 游戏状态 ---------------- */
const SKILL_CD = { nova: 7, blades: 12, chrono: 14 };
const SKILL_NAME = { nova: '阴爆', blades: '纸人', chrono: '凝时' };
const DEBT_DELAY = 22;

let state = 'menu';
let endless = false;
let player, enemies, shadows, parts, drops, debts, ebullets, trail, sealFx;
let sceneIdx = 0, waveIdx = 0, spawnQueue = [], spawnTimer = 0, waveActive = false;
let score = 0, kills = 0, seals = 0, debtsTotal = 0, debtsRepaid = 0, runTime = 0;
let borrowedSet = new Set(), borrowedHistory = [];
let slowTimer = 0, shake = 0, bossRef = null;
let keys = {};
let joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };

function newPlayer() {
  return {
    x: W / 2, y: H / 2, r: 14, hp: 100, maxHp: 100,
    speed: 242, sealDmg: 85, trailLife: 7, crit: 0.05, magnet: 60, chainSeal: false,
    dashTimer: 0, dashCd: 0, dashCdMax: 2.6, dashBoost: false, boostTimer: 0, face: 1,
    skillCd: { nova: 0, blades: 0, chrono: 0 },
    paperTimer: 0, paperAngle: 0, invuln: 0, sealBuffTimer: 0
  };
}

function resetRun(isEndless) {
  endless = isEndless;
  player = newPlayer();
  enemies = []; shadows = []; parts = []; drops = []; debts = []; ebullets = []; trail = []; sealFx = [];
  sceneIdx = 0; waveIdx = 0; score = 0; kills = 0; seals = 0;
  debtsTotal = 0; debtsRepaid = 0; runTime = 0;
  borrowedSet = new Set(); borrowedHistory = [];
  slowTimer = 0; bossRef = null; spawnQueue = []; waveActive = false;
}

/* ---------------- DOM ---------------- */
const $ = id => document.getElementById(id);
const els = {
  hud: $('hud'), skills: $('skills'), menu: $('menu'), chapter: $('chapter'),
  upgrade: $('upgrade'), end: $('end'), pause: $('pause'),
  hpFill: $('hpfill'), hpText: $('hptext'), scene: $('scene-label'), wave: $('wave-label'),
  debtCount: $('debt-count'), scoreCount: $('score-count'), debtAlert: $('debt-alert'),
  chapterTitle: $('chapter-title'), chapterText: $('chapter-text'),
  endTitle: $('end-title'), endStats: $('end-stats'), best: $('best-line'),
  endlessBtn: $('btn-endless')
};

function show(el, on) { el.classList.toggle('hidden', !on); }
function refreshBest() {
  const best = JSON.parse(localStorage.getItem('td_best') || 'null');
  els.best.textContent = best ? ('最佳：时尘 ' + best.score + ' · 封印 ' + (best.seals || 0) + ' 次 · 总借债 ' + best.debts) : '';
  show(els.endlessBtn, !!localStorage.getItem('td_won'));
}
refreshBest();

/* ---------------- 流程 ---------------- */
function startRun(isEndless) {
  resetRun(isEndless);
  show(els.menu, false); show(els.end, false);
  show(els.hud, true); show(els.skills, true);
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
    showChapter();
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
    b.onclick = () => { u.apply(player); beep(392, 0.14, 'triangle', 0.05); show(els.upgrade, false); beginWave(); };
    box.appendChild(b);
  });
  show(els.upgrade, true);
}

function gameOver() {
  state = 'over';
  els.endTitle.textContent = '你留在了那边';
  els.endStats.textContent = statsText('走廊的灯全灭了。契，从你手里飘了出去。');
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

/* ---------------- 敌人 ---------------- */
const ENEMY_DEF = {
  chaser: { hp: 55,  speed: 88,  r: 15, dmg: 10, score: 10 },  /* 爬行者 */
  dart:   { hp: 30,  speed: 172, r: 11, dmg: 8,  score: 14 },  /* 掠影 */
  tank:   { hp: 260, speed: 44,  r: 27, dmg: 18, score: 30 },  /* 缝合巨怪 */
  lurker: { hp: 70,  speed: 76,  r: 14, dmg: 14, score: 24 }   /* 裂喉者：伏行后扑咬 */
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
  show(els.debtAlert, true);
  setTimeout(() => show(els.debtAlert, false), 1700);
  beep(98, 0.4, 'sawtooth', 0.06);
}

function spawnBoss() {
  const skills = borrowedSet.size ? [...borrowedSet] : ['nova'];
  bossRef = {
    boss: true, x: W / 2, y: -50, r: 42,
    hp: 1700 + skills.length * 300, maxHp: 1700 + skills.length * 300,
    speed: 80, dmg: 22, score: 500, skills, skillIdx: 0,
    castTimer: 3.5, paperAngle: 0, papersUntil: 0, phase: 'enter', shardTick: 0
  };
  enemies.push(bossRef);
}

/* ---------------- 借命三咒 ---------------- */
function borrow(skill, btn) {
  if (state !== 'playing' || !player) return;
  if (player.skillCd[skill] > 0) return;
  player.skillCd[skill] = SKILL_CD[skill];
  debts.push({ skill, due: DEBT_DELAY });
  debtsTotal++;
  borrowedSet.add(skill); borrowedHistory.push(skill);
  if (btn) { btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash'); }

  if (skill === 'nova') {           /* 阴爆：以自身为心的煞气爆裂 */
    ring(player.x, player.y, 195, '#ff6a5e');
    enemies.slice().forEach(e => { if (dist2(e, player) < 195 * 195) hurtEnemy(e, 100, player); });
    shadows.slice().forEach(s => { if (dist2(s, player) < 195 * 195) hurtShadow(s, 100); });
    shake = 9; beep(70, 0.4, 'sawtooth', 0.07);
  } else if (skill === 'blades') {  /* 纸人环：三个纸人绕身绞杀 */
    player.paperTimer = 8; beep(330, 0.18, 'triangle', 0.05);
  } else if (skill === 'chrono') {  /* 凝时：万物滞缓，唯你独行 */
    slowTimer = 5; beep(587, 0.3, 'sine', 0.05);
  }
  burst(player.x, player.y, 10, '#ff6a5e');
}

function hurtEnemy(e, dmg, from) {
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

/* ---------------- 朱砂封印（核心战斗） ---------------- */
function trySeal(poly) {
  const crit = Math.random() < player.crit;
  let dmg = player.sealDmg * (crit ? 2 : 1);
  if (player.chainSeal && player.sealBuffTimer > 0) dmg *= 1.6;
  let hit = 0;
  enemies.slice().forEach(e => {
    if (pointInPoly(e.x, e.y, poly)) { hurtEnemy(e, e.boss ? dmg * 0.6 : dmg, null); hit++; }
  });
  shadows.slice().forEach(s => {
    if (pointInPoly(s.x, s.y, poly)) { hurtShadow(s, dmg); hit++; }
  });
  seals++;
  if (player.chainSeal) player.sealBuffTimer = 3;
  score += hit * 15 + Math.floor(polyArea(poly) / 600);
  sealFx.push({ poly, t: 0, crit });
  shake = Math.max(shake, hit ? 5 : 2);
  beep(crit ? 196 : 262, 0.2, 'triangle', 0.06);
  const c = centroid(poly);
  burst(c.x, c.y, hit ? 22 : 8, crit ? '#ffd76e' : '#ff4b3e');
}

function centroid(poly) {
  let x = 0, y = 0;
  poly.forEach(p => { x += p.x; y += p.y; });
  return { x: x / poly.length, y: y / poly.length };
}

function updateTrail(dt) {
  trail.forEach(p => { p.age += dt; });
  trail = trail.filter(p => p.age < player.trailLife);
  const last = trail[trail.length - 1];
  if (!last || Math.hypot(player.x - last.x, player.y - last.y) >= 13) {
    trail.push({ x: player.x, y: player.y, age: 0 });
    if (trail.length > 300) trail.shift();
    /* 闭合检测：当前位置碰到足够久以前的轨迹点，且圈面积达标 */
    for (let i = 0; i < trail.length - 22; i++) {
      const p = trail[i];
      if (Math.hypot(player.x - p.x, player.y - p.y) < 26) {
        const poly = trail.slice(i);
        if (polyArea(poly) > 3200) { trySeal(poly); trail = []; }
        break;
      }
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
let rings = [];
function ring(x, y, r, color) { rings.push({ x, y, r, color, t: 0 }); }

/* ---------------- 输入 ---------------- */
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyJ') borrow('nova', document.querySelector('[data-skill="nova"]'));
  if (e.code === 'KeyK') borrow('blades', document.querySelector('[data-skill="blades"]'));
  if (e.code === 'KeyL') borrow('chrono', document.querySelector('[data-skill="chrono"]'));
  if (e.code === 'Escape' && state === 'playing') pauseGame();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

document.querySelectorAll('.skill-btn[data-skill]').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); borrow(b.dataset.skill, b); });
});
$('btn-dash').addEventListener('pointerdown', e => { e.preventDefault(); tryDash(); });

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

function tryDash() {
  if (state !== 'playing' || !player || player.dashCd > 0) return;
  player.dashTimer = 0.16; player.dashCd = player.dashCdMax; player.invuln = Math.max(player.invuln, 0.2);
  trail = []; /* 冲刺会断印：想封印，就别乱冲 */
  beep(349, 0.09, 'sine', 0.04);
}

/* ---------------- 按钮 ---------------- */
$('btn-start').onclick = () => startRun(false);
els.endlessBtn.onclick = () => startRun(true);
$('btn-chapter').onclick = () => beginWave();
$('btn-retry').onclick = () => startRun(endless);
$('btn-tomenu').onclick = () => location.reload();
$('btn-pause').onclick = () => pauseGame();
$('btn-resume').onclick = () => { show(els.pause, false); state = 'playing'; };
$('btn-quit').onclick = () => location.reload();
$('btn-mute').onclick = e => { muted = !muted; e.target.textContent = muted ? '×' : '♪'; };
function pauseGame() { if (state !== 'playing') return; state = 'paused'; show(els.pause, true); }

/* ---------------- 主循环 ---------------- */
let lastTs = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min((ts - lastTs) / 1000 || 0, 0.05);
  lastTs = ts;
  if (state === 'playing') update(dt);
  render();
}
requestAnimationFrame(loop);

function enemyTimeScale() { return slowTimer > 0 ? 0.38 : 1; }

function update(dt) {
  runTime += dt;
  const ts = enemyTimeScale();
  if (slowTimer > 0) slowTimer -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 26);

  for (let i = debts.length - 1; i >= 0; i--) {
    debts[i].due -= dt;
    if (debts[i].due <= 0) { const d = debts.splice(i, 1)[0]; spawnShadow(d.skill); }
  }

  /* 移动 */
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (joy.active) { mx += joy.dx; my += joy.dy; }
  const mm = Math.hypot(mx, my);
  if (mm > 1) { mx /= mm; my /= mm; }
  if (keys.Space) tryDash();
  let spd = player.speed * (slowTimer > 0 ? 1.18 : 1);
  if (player.boostTimer > 0) { player.boostTimer -= dt; spd *= 1.45; }
  if (player.dashTimer > 0) { player.dashTimer -= dt; spd *= 3.1; if (player.dashBoost && player.dashTimer <= 0) player.boostTimer = 0.5; }
  player.x = clamp(player.x + mx * spd * dt, player.r, W - player.r);
  player.y = clamp(player.y + my * spd * dt, player.r, H - player.r);
  if (mx !== 0) player.face = mx > 0 ? 1 : -1;
  if (player.dashCd > 0) player.dashCd -= dt;
  if (player.invuln > 0) player.invuln -= dt;
  if (player.sealBuffTimer > 0) player.sealBuffTimer -= dt;
  for (const k in player.skillCd) if (player.skillCd[k] > 0) player.skillCd[k] -= dt;
  if (player.paperTimer > 0) { player.paperTimer -= dt; player.paperAngle += dt * 4.4; }

  updateTrail(dt);

  /* 纸人环绞杀 */
  if (player.paperTimer > 0) {
    for (let i = 0; i < 3; i++) {
      const a = player.paperAngle + i * (Math.PI * 2 / 3);
      const bx = player.x + Math.cos(a) * 52, by = player.y + Math.sin(a) * 52;
      enemies.slice().forEach(e => { if (dist2(e, { x: bx, y: by }) < (e.r + 13) * (e.r + 13) && (e.shardTick || 0) <= 0) { e.shardTick = 0.22; hurtEnemy(e, 26, player); } });
      shadows.slice().forEach(s => { if (dist2(s, { x: bx, y: by }) < (s.r + 13) * (s.r + 13) && (s.shardTick || 0) <= 0) { s.shardTick = 0.22; hurtShadow(s, 26); } });
    }
  }
  enemies.forEach(e => { if (e.shardTick > 0) e.shardTick -= dt; });
  shadows.forEach(s => { if (s.shardTick > 0) s.shardTick -= dt; });

  if (spawnQueue.length) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = 0.55; spawnEnemy(spawnQueue.shift()); }
  }

  const edt = dt * ts;
  enemies.slice().forEach(e => updateEnemy(e, edt, dt));
  shadows.slice().forEach(s => updateShadow(s, edt, dt));

  /* 敌方冥火（仅 Boss 与讨债影的咒术，玩家不再射击） */
  ebullets = ebullets.filter(b => {
    b.x += b.vx * edt; b.y += b.vy * edt; b.life -= dt;
    if (b.life <= 0) return false;
    if (player.invuln <= 0 && dist2(b, player) < (player.r + 5) * (player.r + 5)) { damagePlayer(b.dmg); return false; }
    return true;
  });

  drops = drops.filter(d => {
    const dd = Math.sqrt(dist2(d, player));
    if (dd < player.magnet) { d.x += (player.x - d.x) * dt * 7; d.y += (player.y - d.y) * dt * 7; }
    if (dd < player.r + 10) {
      if (d.kind === 'xp') { score += d.v; beep(784, 0.05, 'sine', 0.02); }
      else { player.hp = Math.min(player.maxHp, player.hp + d.v); beep(440, 0.09, 'sine', 0.04); }
      return false;
    }
    return true;
  });

  parts = parts.filter(p => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.t < p.life; });
  rings = rings.filter(r => { r.t += dt * 2.4; return r.t < 1; });
  sealFx = sealFx.filter(f => { f.t += dt * 2; return f.t < 1; });

  if (waveActive && !spawnQueue.length && !enemies.length && !shadows.length) waveCleared();
  updateHud();
}

function updateEnemy(e, edt, rawDt) {
  if (e.boss) return updateBoss(e, edt, rawDt);
  const a = Math.atan2(player.y - e.y, player.x - e.x);
  e.wob += rawDt * 3;
  if (e.type === 'lurker') {
    e.modeTimer -= rawDt;
    if (e.mode === 'stalk') {
      e.x += Math.cos(a) * e.speed * edt; e.y += Math.sin(a) * e.speed * edt;
      if (e.modeTimer <= 0 && Math.sqrt(dist2(e, player)) < 300) { e.mode = 'aim'; e.modeTimer = 0.6; }
    } else if (e.mode === 'aim') {          /* 裂喉：伏地蓄扑，方向锁定 */
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
  if (player.invuln <= 0 && dist2(e, player) < (e.r + player.r) * (e.r + player.r)) {
    damagePlayer(e.dmg);
    e.x -= Math.cos(a) * 26; e.y -= Math.sin(a) * 26;
  }
}

function updateShadow(s, edt, rawDt) {
  const a = Math.atan2(player.y - s.y, player.x - s.x);
  const effDt = s.skill === 'chrono' ? rawDt : edt; /* 借了凝时的影子不受凝时影响 */
  s.x += Math.cos(a) * s.speed * effDt; s.y += Math.sin(a) * s.speed * effDt;
  s.castTimer -= effDt;
  if (s.skill === 'blades') {
    s.paperAngle += effDt * 4.4;
    const rad = runTime < s.spinUntil ? 62 : 46;
    for (let i = 0; i < 3; i++) {
      const ba = s.paperAngle + i * (Math.PI * 2 / 3);
      const bx = s.x + Math.cos(ba) * rad, by = s.y + Math.sin(ba) * rad;
      if (player.invuln <= 0 && dist2(player, { x: bx, y: by }) < (player.r + 12) * (player.r + 12)) damagePlayer(14);
    }
  }
  if (s.castTimer <= 0) {
    if (s.skill === 'nova') {
      s.castTimer = 3.4; s.telegraph = 0.7;
      setTimeout(() => {
        if (state !== 'playing' || !shadows.includes(s)) return;
        ring(s.x, s.y, 130, '#ff5d7a');
        if (player.invuln <= 0 && dist2(player, s) < 130 * 130) damagePlayer(20);
      }, 700);
    } else if (s.skill === 'chrono') {
      s.castTimer = 4;
      s.x += Math.cos(a) * 130; s.y += Math.sin(a) * 130;
      burst(s.x, s.y, 8, '#8cdcff');
    } else {
      s.castTimer = 3.2; s.spinUntil = runTime + 1.6; /* 纸人环骤然扩张 */
    }
  }
  if (player.invuln <= 0 && dist2(s, player) < (s.r + player.r) * (s.r + player.r)) {
    damagePlayer(s.dmg);
    s.x -= Math.cos(a) * 30; s.y -= Math.sin(a) * 30;
  }
}

function updateBoss(e, edt, rawDt) {
  if (e.phase === 'enter') { e.y += 86 * rawDt; if (e.y >= 112) e.phase = 'fight'; return; }
  const a = Math.atan2(player.y - e.y, player.x - e.x);
  e.x += Math.cos(a) * e.speed * edt; e.y += Math.sin(a) * e.speed * edt;
  e.castTimer -= rawDt;
  if (e.castTimer <= 0) {
    const skill = e.skills[e.skillIdx % e.skills.length];
    e.skillIdx++; e.castTimer = 4.2;
    if (skill === 'nova') {           /* 阴爆 → 冥火环散 */
      ring(e.x, e.y, 170, '#ff5d7a');
      for (let i = 0; i < 14; i++) {
        const ba = (i / 14) * Math.PI * 2;
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(ba) * 185, vy: Math.sin(ba) * 185, dmg: 12, life: 3 });
      }
    } else if (skill === 'blades') {  /* 纸人环 */
      e.papersUntil = runTime + 6;
    } else if (skill === 'chrono') {  /* 凝时突进 */
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
      if (player.invuln <= 0 && dist2(player, { x: bx, y: by }) < (player.r + 14) * (player.r + 14)) damagePlayer(16);
    }
  }
  if (player.invuln <= 0 && dist2(e, player) < (e.r + player.r) * (e.r + player.r)) {
    damagePlayer(e.dmg);
    player.x -= Math.cos(a) * 34; player.y -= Math.sin(a) * 34;
  }
}

function damagePlayer(dmg) {
  if (player.invuln > 0 || state !== 'playing') return;
  player.hp -= dmg; player.invuln = 0.55; shake = Math.max(shake, 5);
  burst(player.x, player.y, 8, '#ff5d7a');
  beep(82, 0.16, 'sawtooth', 0.06);
  if (player.hp <= 0) { player.hp = 0; gameOver(); }
}

/* ---------------- HUD ---------------- */
const skillBtns = {};
document.querySelectorAll('.skill-btn[data-skill]').forEach(b => { skillBtns[b.dataset.skill] = b; });
function updateHud() {
  const scene = SCENES[sceneIdx % SCENES.length];
  els.hpFill.style.width = (player.hp / player.maxHp * 100) + '%';
  els.hpText.textContent = Math.ceil(player.hp) + ' / ' + player.maxHp;
  els.scene.textContent = (endless && sceneIdx >= SCENES.length ? '无尽 · ' : '') + scene.name;
  const w = scene.waves[waveIdx];
  els.wave.textContent = w && w.boss ? '最终讨债' : ('第 ' + (waveIdx + 1) + ' / ' + scene.waves.length + ' 波 · 余祟 ' + (enemies.length + shadows.length + spawnQueue.length));
  els.debtCount.textContent = debts.length + shadows.length;
  els.scoreCount.textContent = score;
  for (const k in skillBtns) {
    const cd = skillBtns[k].querySelector('.sk-cd');
    const remain = Math.max(0, player.skillCd[k]);
    cd.style.width = (remain / SKILL_CD[k] * 100) + '%';
    skillBtns[k].style.opacity = remain > 0 ? 0.55 : 1;
  }
  const dashBtn = $('btn-dash');
  dashBtn.querySelector('.sk-cd').style.width = (Math.max(0, player.dashCd) / player.dashCdMax * 100) + '%';
  dashBtn.style.opacity = player.dashCd > 0 ? 0.55 : 1;
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

  if (scene.theme === 'house') {            /* 雨 */
    ctx.strokeStyle = 'rgba(159,183,255,0.25)'; ctx.lineWidth = 1;
    decor.forEach(d => {
      const y = ((d.y + t * 0.55 * (0.5 + d.r * 0.3)) % 1) * H, x = d.x * W + y * 0.06;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 13); ctx.stroke();
    });
  } else if (scene.theme === 'ward') {      /* 浮尘 + 灯闪 */
    decor.forEach(d => {
      ctx.fillStyle = 'rgba(180,230,190,0.14)';
      ctx.beginPath(); ctx.arc(d.x * W + Math.sin(t * 0.4 + d.p) * 12, d.y * H, d.r * 1.8, 0, 7); ctx.fill();
    });
    if (Math.sin(t * 1.7) > 0.995 || Math.sin(t * 4.3) > 0.998) { ctx.fillStyle = 'rgba(200,255,210,0.05)'; ctx.fillRect(0, 0, W, H); }
  } else {                                  /* 血月 + 余烬 */
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

  if (!player) { ctx.restore(); return; }

  /* 朱砂轨迹 */
  if (trail.length > 1) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      trail.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.strokeStyle = pass === 0 ? 'rgba(255,59,48,0.20)' : 'rgba(255,84,66,0.85)';
      ctx.lineWidth = pass === 0 ? 7 : 2.6;
      ctx.stroke();
    }
    const head = trail[trail.length - 1];
    ctx.fillStyle = 'rgba(255,120,100,0.9)';
    ctx.beginPath(); ctx.arc(head.x, head.y, 3.4, 0, 7); ctx.fill();
  }

  /* 封印闪光 */
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

  if (player.paperTimer > 0) {
    for (let i = 0; i < 3; i++) {
      const a = player.paperAngle + i * (Math.PI * 2 / 3);
      drawShard(player.x + Math.cos(a) * 52, player.y + Math.sin(a) * 52, '#f2ecd9');
    }
  }

  const blink = player.invuln > 0 && Math.floor(t * 16) % 2 === 0;
  if (!blink) {
    ctx.fillStyle = '#e9e4d8';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a1a22';
    ctx.beginPath(); ctx.arc(player.x + player.face * 5, player.y - 2, 5.5, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,84,66,0.65)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r + 5 + Math.sin(t * 4) * 1.5, 0, 7); ctx.stroke();
  }

  parts.forEach(p => {
    ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  });
  rings.forEach(r => {
    ctx.globalAlpha = 1 - r.t; ctx.strokeStyle = r.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r * r.t, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  });

  /* 提灯视野：光圈之外，皆是暗处 */
  const flick = Math.sin(t * 11) * 5 + Math.sin(t * 23.7) * 3;
  const lg = ctx.createRadialGradient(player.x, player.y, 60, player.x, player.y, 265 + flick);
  lg.addColorStop(0, 'rgba(0,0,0,0)');
  lg.addColorStop(0.72, 'rgba(0,0,0,0.18)');
  lg.addColorStop(1, 'rgba(0,0,0,0.66)');
  ctx.fillStyle = lg; ctx.fillRect(-12, -12, W + 24, H + 24);

  if (joy.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(joy.ox, joy.oy, 46, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(joy.ox + joy.dx * 34, joy.oy + joy.dy * 34, 18, 0, 7); ctx.fill();
  }
  ctx.restore();
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
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = scene.enemy;
  if (e.type === 'tank') {
    ctx.fillRect(-e.r, -e.r, e.r * 2, e.r * 2);
    ctx.strokeStyle = 'rgba(120,20,20,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-e.r, -6); ctx.lineTo(e.r, 2); ctx.moveTo(-e.r, 12); ctx.lineTo(e.r, 6); ctx.stroke();
  } else if (e.type === 'dart') {
    ctx.rotate(Math.atan2(player.y - e.y, player.x - e.x));
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
