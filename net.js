'use strict';
/* 联机层 v2（v0.4 解谜版）：房主权威 + 状态同步，最多 4 人（房主 + 3 位客人）。
   房主持有全部游戏状态，客人发送「动作意图」，房主校验执行后广播全量状态。
   传输：PeerJS（WebRTC 点对点）+ 免费公共信令；库文件同源托管。 */
window.TDNet = {
  role: 'solo', peer: null, code: null, myId: 0,
  conns: {},            // 房主：guestId -> conn
  hostConn: null,       // 客人：到房主的连接
  knownCount: 1,        // 客人端已知的总人数
  onMsg: null,          // 客人：收到房主消息
  onGuestMsg: null,     // 房主：收到某客人消息 (data, guestId)
  onRoster: null,       // 人数变化回调 (count)
  onStatus: null,

  _status: function (s) { if (this.onStatus) this.onStatus(s); },
  playerCount: function () {
    if (this.role === 'host') return 1 + Object.keys(this.conns).length;
    if (this.role === 'guest') return this.knownCount;
    return 1;
  },

  makeCode: function () {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 4; i++) c += abc[Math.floor(Math.random() * abc.length)];
    return c;
  },

  host: function () {
    if (typeof Peer === 'undefined') { this._status('联机组件未加载，只能单人或同屏'); return; }
    this.close();
    this.role = 'host'; this.myId = 0;
    this.code = this.makeCode();
    const self = this;
    this.peer = new Peer('td4-' + this.code);
    this.peer.on('open', function () { self._status('房间已建 · 房码告诉同行者： ' + self.code + '（最多 4 人）'); });
    this.peer.on('connection', function (conn) {
      conn.on('open', function () {
        const ids = Object.keys(self.conns).map(Number);
        if (ids.length >= 3) { try { conn.send({ t: 'full' }); } catch (e) {} setTimeout(() => conn.close(), 300); return; }
        let id = 1; while (ids.includes(id)) id++;
        self.conns[id] = conn;
        conn._gid = id;
        conn.send({ t: 'welcome', id, count: self.playerCount() });
        self.broadcast({ t: 'roster', count: self.playerCount() });
        self._status('同行者 ' + id + ' 号连入 · 现在 ' + self.playerCount() + ' 人');
        if (self.onRoster) self.onRoster(self.playerCount());
        conn.on('data', function (d) { if (self.onGuestMsg) self.onGuestMsg(d, id); });
        conn.on('close', function () {
          delete self.conns[id];
          self.broadcast({ t: 'roster', count: self.playerCount() });
          self._status('同行者 ' + id + ' 号离开 · 现在 ' + self.playerCount() + ' 人');
          if (self.onRoster) self.onRoster(self.playerCount());
        });
      });
    });
    this.peer.on('error', function (err) {
      if (err.type === 'unavailable-id') { self.host(); return; }
      self._status('联机出错：' + err.type + '（可改用单人）');
    });
  },

  join: function (code) {
    if (typeof Peer === 'undefined') { this._status('联机组件未加载，只能单人或同屏'); return; }
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4) { this._status('房码是 4 位字符'); return; }
    this.close();
    this.role = 'guest'; this.code = code;
    const self = this;
    this.peer = new Peer();
    this.peer.on('open', function () {
      self.hostConn = self.peer.connect('td4-' + code, { reliable: true });
      self.hostConn.on('open', function () { self._status('已连上房间 ' + code + ' · 等待房主同步'); });
      self.hostConn.on('data', function (d) {
        if (d.t === 'welcome') { self.myId = d.id; self.knownCount = d.count; self._status('你是 ' + d.id + ' 号同行者 · 共 ' + d.count + ' 人'); }
        else if (d.t === 'roster') { self.knownCount = d.count; if (self.onRoster) self.onRoster(d.count); }
        else if (d.t === 'full') { self._status('房间满了（最多 4 人）'); }
        if (self.onMsg) self.onMsg(d);
      });
      self.hostConn.on('close', function () { self._status('与房主的连接断开了'); });
    });
    this.peer.on('error', function (err) {
      if (err.type === 'peer-unavailable') self._status('找不到这个房间，核对房码或等房主先建房');
      else self._status('联机出错：' + err.type);
    });
  },

  broadcast: function (obj) {
    for (const id in this.conns) {
      const c = this.conns[id];
      if (c.open) { try { c.send(obj); } catch (e) {} }
    }
  },
  send: function (obj) {
    if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(obj); } catch (e) {} }
  },

  close: function () {
    for (const id in this.conns) { try { this.conns[id].close(); } catch (e) {} }
    try { if (this.hostConn) this.hostConn.close(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.conns = {}; this.hostConn = null; this.peer = null;
    this.role = 'solo'; this.myId = 0; this.knownCount = 1;
  }
};
