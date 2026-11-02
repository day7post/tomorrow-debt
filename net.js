'use strict';
/* 联机传输层：PeerJS（WebRTC 点对点）+ 免费公共信令。
   房主权威：房主跑全部游戏逻辑，客人只发输入、收状态快照渲染。
   库文件 peerjs.min.js 与游戏同源托管，不依赖第三方 CDN。 */
window.TDNet = {
  role: 'solo',           // solo | host | guest
  peer: null, conn: null, code: null,
  guestInput: { mx: 0, my: 0 },
  guestBorrow: [],
  guestDash: false,
  onMsg: null,            // game.js 注册：收到对方消息
  onStatus: null,         // game.js 注册：状态文案回调
  onPeerJoin: null,       // 房主：客人连入
  onPeerLeave: null,      // 任一端：连接断开

  _status: function (s) { if (this.onStatus) this.onStatus(s); },

  makeCode: function () {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 4; i++) c += abc[Math.floor(Math.random() * abc.length)];
    return c;
  },

  host: function () {
    if (typeof Peer === 'undefined') { this._status('联机组件未加载，只能同屏双人'); return; }
    this.close();
    this.role = 'host';
    this.code = this.makeCode();
    const self = this;
    this.peer = new Peer('td3-' + this.code);
    this.peer.on('open', function () {
      self._status('房间已建 · 把房码告诉同行者： ' + self.code);
    });
    this.peer.on('connection', function (conn) {
      if (self.conn && self.conn.open) { conn.close(); return; } // 只收一位同行者
      self.conn = conn;
      self._bindConn();
      conn.on('open', function () {
        self._status('同行者已连入 · 房码 ' + self.code);
        if (self.onPeerJoin) self.onPeerJoin();
      });
    });
    this.peer.on('error', function (err) {
      if (err.type === 'unavailable-id') { self.host(); return; } // 房码撞了，换一个
      self._status('联机出错：' + err.type + '（可改用同屏双人）');
    });
  },

  join: function (code) {
    if (typeof Peer === 'undefined') { this._status('联机组件未加载，只能同屏双人'); return; }
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4) { this._status('房码是 4 位字符'); return; }
    this.close();
    this.role = 'guest';
    this.code = code;
    const self = this;
    this.peer = new Peer();
    this.peer.on('open', function () {
      self.conn = self.peer.connect('td3-' + code, { reliable: true });
      self._bindConn();
      self.conn.on('open', function () { self._status('已连入房间 ' + code + ' · 等待房主开始'); });
    });
    this.peer.on('error', function (err) {
      if (err.type === 'peer-unavailable') self._status('找不到这个房间，核对房码或等房主先建房');
      else self._status('联机出错：' + err.type);
    });
  },

  _bindConn: function () {
    const self = this;
    this.conn.on('data', function (d) { if (self.onMsg) self.onMsg(d); });
    this.conn.on('close', function () {
      self._status('连接已断开');
      if (self.onPeerLeave) self.onPeerLeave();
    });
  },

  send: function (obj) {
    if (this.conn && this.conn.open) { try { this.conn.send(obj); } catch (e) { /* 断连静默 */ } }
  },

  close: function () {
    try { if (this.conn) this.conn.close(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.conn = null; this.peer = null; this.role = 'solo';
    this.guestInput = { mx: 0, my: 0 }; this.guestBorrow = []; this.guestDash = false;
  }
};
