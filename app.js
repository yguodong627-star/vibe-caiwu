/* 细水账 UI —— 纯前端，数据存 IndexedDB（不可用时退回 localStorage），不联网。 */
(function () {
  'use strict';
  var C = window.Core;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var PAL = ['#39718b', '#c3a15a', '#73868f', '#b4553a', '#5b8f7b', '#8c6f4e', '#7fa3b5', '#2f5568', '#c9856a', '#a9b8c0'];
  var SRC_NAME = { alipay: '支付宝', wechat: '微信', cmb: '招商银行', icbc: '工商银行', csv: '自定义CSV', manual: '手动' };

  /* ---------- 状态 ---------- */
  function freshState() {
    return { v: 1, txs: [], batches: [], rules: JSON.parse(JSON.stringify(C.DEFAULT_RULES)), subs: {}, manual: [], budget: { total: null, cats: {} }, settings: { tol: 10, remind: 7 }, lastBackup: null, seq: 1 };
  }
  var S = freshState();
  var UI = { view: 'overview', month: null, scope: 'all', f: { q: '', month: '', cat: '', kind: '' }, rows: 100, pv: [], sampleHint: true };
  function todayStr() {
    var m = /[?&]today=(\d{4}-\d{2}-\d{2})/.exec(location.search); if (m) return m[1];
    var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  var TODAY = todayStr();

  /* ---------- 存储 ---------- */
  var DB = null, saveTimer = null, storageOK = true;
  function openDB() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('xishui-caiwu', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
        rq.onsuccess = function () { DB = rq.result; res(); };
        rq.onerror = function () { res(); };
      } catch (e) { res(); }
    });
  }
  function dbGet() {
    return new Promise(function (res) {
      if (DB) { try { var r = DB.transaction('kv').objectStore('kv').get('state'); r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); }; return; } catch (e) { } }
      try { var t = localStorage.getItem('xishui-caiwu-state'); res(t ? JSON.parse(t) : null); } catch (e) { res(null); }
    });
  }
  function persistNow() {
    return new Promise(function (res) {
      if (DB) {
        try { var tx = DB.transaction('kv', 'readwrite'); tx.objectStore('kv').put(S, 'state'); tx.oncomplete = function () { storageOK = true; res(); }; tx.onerror = tx.onabort = function () { storageOK = false; renderBanner(); res(); }; return; } catch (e) { }
      }
      try { localStorage.setItem('xishui-caiwu-state', JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; renderBanner(); }
      res();
    });
  }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { saveTimer = null; persistNow(); }, 80); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && saveTimer) { clearTimeout(saveTimer); saveTimer = null; persistNow(); } });
  window.addEventListener('pagehide', function () { if (saveTimer) { clearTimeout(saveTimer); persistNow(); } });

  /* ---------- 小工具 ---------- */
  var fmt = C.fmt;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('on'); }, 2800); }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;   // 防 Excel 公式注入
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function monthLabel(m) { return m.slice(0, 4) + '年' + (+m.slice(5)) + '月'; }
  function yuan(c) { return (c / 100).toFixed(2); }
  function scoped() { return UI.scope === 'all' ? S.txs : S.txs.filter(function (t) { return t.src === UI.scope; }); }
  function sources() { var o = {}; S.txs.forEach(function (t) { o[t.src] = 1; }); return Object.keys(o); }
  function allCats() {
    var o = {}; S.rules.forEach(function (r) { o[r.cat] = 1; }); S.txs.forEach(function (t) { o[t.cat] = 1; });
    Object.keys(S.budget.cats).forEach(function (c) { o[c] = 1; }); o['未分类'] = 1;
    return Object.keys(o);
  }
  function catColor(cat) { var cs = allCats().sort(); return PAL[cs.indexOf(cat) % PAL.length]; }
  function curMonth() {
    if (UI.month) return UI.month;
    var ms = C.monthsOf(scoped()), tm = TODAY.slice(0, 7);
    var le = ms.filter(function (m) { return m <= tm; });
    return le.length ? le[le.length - 1] : tm;
  }
  function shiftMonth(m, k) { var t = +m.slice(0, 4) * 12 + (+m.slice(5) - 1) + k; return Math.floor(t / 12) + '-' + ('0' + (t % 12 + 1)).slice(-2); }

  /* ---------- 订阅整理 ---------- */
  function computeSubs() {
    var cands = C.detectRecurring(scoped(), { tol: S.settings.tol / 100 });
    var seen = {}, list = [];
    cands.forEach(function (c) {
      seen[c.key] = 1;
      var d = S.subs[c.key], st = d ? d.s : 'pending';
      list.push({ kind: 'auto', key: c.key, name: c.merchant, period: c.period, amount: c.amount, next: c.next, last: c.last, st: st, cand: c, cat: c.cat });
    });
    Object.keys(S.subs).forEach(function (k) {
      if (seen[k]) return; var d = S.subs[k];
      if (d.s === 'confirmed' || d.s === 'canceled') list.push({ kind: 'auto', key: k, name: d.snap.name, period: d.snap.period, amount: d.snap.amount, next: d.snap.next, last: d.snap.last, st: d.s, stale: true, cat: d.snap.cat });
    });
    S.manual.forEach(function (m) { list.push({ kind: 'manual', key: 'm:' + m.id, id: m.id, name: m.name, period: m.period, amount: m.amount, next: m.next, st: m.canceled ? 'canceled' : 'confirmed', cat: m.cat || '订阅会员' }); });
    list.forEach(function (x) { x.due = x.next ? C.dueStatus(x.next, x.period, TODAY, S.settings.remind) : { s: 'ok', d: 999 }; x.annual = C.annual(x.amount, x.period); });
    return list;
  }
  function subSummary(list) {
    var act = list.filter(function (x) { return x.st === 'confirmed' && x.due.s !== 'stopped'; });
    var stopped = list.filter(function (x) { return x.st === 'confirmed' && x.due.s === 'stopped'; });
    return { act: act, stopped: stopped, annual: act.reduce(function (s, x) { return s + x.annual; }, 0), stoppedAnnual: stopped.reduce(function (s, x) { return s + x.annual; }, 0), pending: list.filter(function (x) { return x.st === 'pending'; }) };
  }

  /* ---------- 提醒 ---------- */
  function reminders(list) {
    var out = [], m = curMonth(), st = C.monthStats(scoped(), m);
    var bt = C.budgetStatus(st.net, S.budget.total);
    if (bt && bt.level === 'over') out.push({ lv: 'over', ic: '!', t: monthLabel(m) + '总支出已超预算 ' + fmt(-bt.left), s: '已花 ' + fmt(st.net) + '，预算 ' + fmt(S.budget.total), go: 'budget' });
    else if (bt && bt.level === 'warn') out.push({ lv: 'warn', ic: '!', t: monthLabel(m) + '总支出已用掉预算的 ' + Math.round(bt.pct * 100) + '%', s: '已花 ' + fmt(st.net) + '，预算 ' + fmt(S.budget.total) + '，还剩 ' + fmt(bt.left), go: 'budget' });
    Object.keys(S.budget.cats).forEach(function (c) {
      var b = S.budget.cats[c]; if (!b) return; var v = st.byCat[c] || 0, s = C.budgetStatus(v, b);
      if (s && s.level === 'over') out.push({ lv: 'over', ic: '!', t: '「' + c + '」超预算 ' + fmt(-s.left), s: '已花 ' + fmt(v) + ' / 预算 ' + fmt(b), go: 'budget' });
      else if (s && s.level === 'warn') out.push({ lv: 'warn', ic: '!', t: '「' + c + '」已用 ' + Math.round(s.pct * 100) + '%', s: '已花 ' + fmt(v) + ' / 预算 ' + fmt(b), go: 'budget' });
    });
    list.filter(function (x) { return x.st === 'confirmed'; }).forEach(function (x) {
      if (x.due.s === 'today') out.push({ lv: 'warn', ic: '◷', t: x.name + ' 预计今天扣费 ' + fmt(x.amount), s: x.cand ? '依据：最近一笔 ' + x.last : '手动添加的订阅', go: 'subs' });
      else if (x.due.s === 'soon') out.push({ lv: 'info', ic: '◷', t: x.name + ' 将在 ' + x.due.d + ' 天后（' + x.next + '）扣费 ' + fmt(x.amount), s: C.PERIODS[x.period].label + ' · 年化 ' + fmt(x.annual), go: 'subs' });
      else if (x.due.s === 'late') out.push({ lv: 'warn', ic: '◷', t: x.name + ' 已过预计扣费日 ' + x.due.d + ' 天，仍未见新扣款', s: '可能延迟、已取消，或账单还没导入最新数据', go: 'subs' });
    });
    var pend = subSummary(list).pending.length;
    if (pend) out.push({ lv: 'info', ic: '?', t: '有 ' + pend + ' 条周期扣费识别结果等你确认或排除', s: '确认后才会计入年化订阅成本和提醒', go: 'subs' });
    var rv = S.txs.filter(function (t) { return t.rv && !t.rvOk; }).length;
    if (rv) out.push({ lv: 'warn', ic: '!', t: rv + ' 笔流水带“待核对”提示（如状态含退款但没有对应退款行）', s: '在“流水”里筛选“待核对”处理', go: 'tx', f: 'rv' });
    return out;
  }

  /* ---------- 渲染框架 ---------- */
  var NAV = [['overview', '总览', 'Ⅰ'], ['tx', '流水', 'Ⅱ'], ['subs', '订阅', 'Ⅲ'], ['budget', '预算', 'Ⅳ'], ['rules', '规则', 'Ⅴ'], ['data', '数据', 'Ⅵ']];
  function renderNav(list) {
    var pend = subSummary(list).pending.length;
    $('#nav').innerHTML = NAV.map(function (n) {
      return '<button data-act="nav" data-v="' + n[0] + '" class="' + (UI.view === n[0] ? 'on' : '') + '"' + (UI.view === n[0] ? ' aria-current="page"' : '') + '><i>' + n[2] + '</i>' + n[1] + (n[0] === 'subs' && pend ? '<span class="dot">' + pend + '</span>' : '') + '</button>';
    }).join('');
  }
  function renderBanner() {
    var b = $('#banner'), msg = '';
    if (!storageOK) msg = '⚠ 无法写入浏览器本地存储（可能是隐私模式或空间已满），本次改动关闭页面后会丢失。请立即“导出备份”。';
    else if (S.txs.length && (!S.lastBackup || (Date.parse(TODAY) - Date.parse(S.lastBackup)) / 864e5 > 30)) msg = S.lastBackup ? '距上次导出备份已超过 30 天。' : '你还没有导出过备份。数据只在本浏览器里，清理浏览器数据就没了。';
    if (msg) { b.hidden = false; b.innerHTML = esc(msg) + ' <button class="btn sm" data-act="nav" data-v="data">去备份</button>'; } else b.hidden = true;
  }
  function scopeSel() {
    var src = sources(); if (src.length < 2) return '';
    return '<select id="scopeSel" aria-label="账单范围" class="stepper-sel" data-act="scope" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);color:#f7f8fa;border-radius:30px;height:30px;padding:0 12px;font-size:12px"><option value="all"' + (UI.scope === 'all' ? ' selected' : '') + '>全部来源</option>' + src.map(function (s) { return '<option value="' + s + '"' + (UI.scope === s ? ' selected' : '') + '>' + (SRC_NAME[s] || s) + '</option>'; }).join('') + '</select>';
  }
  function monthStepper() {
    var m = curMonth(), ms = C.monthsOf(scoped()), tm = TODAY.slice(0, 7);
    if (ms.indexOf(m) < 0) ms.push(m); if (ms.indexOf(tm) < 0) ms.push(tm); ms.sort();
    return '<div class="stepper"><button data-act="mprev" aria-label="上个月">‹</button><select data-act="mset" aria-label="选择月份">' + ms.map(function (x) { return '<option value="' + x + '"' + (x === m ? ' selected' : '') + '>' + monthLabel(x) + '</option>'; }).join('') + '</select><button data-act="mnext" aria-label="下个月">›</button>' + scopeSel() + '</div>';
  }

  var rendering = false, again = false;
  function render() {
    if (rendering) { again = true; return; }
    rendering = true;
    try { render1(); } finally { rendering = false; }
    if (again) { again = false; render(); }
  }
  function render1() {
    var list = computeSubs();
    renderNav(list); renderBanner();
    var V = { overview: vOverview, tx: vTx, subs: vSubs, budget: vBudget, rules: vRules, data: vData }[UI.view];
    V(list);
    document.title = '细水账 · ' + NAV.filter(function (n) { return n[0] === UI.view; })[0][1];
  }

  /* ---------- 图表（SVG 自绘） ---------- */
  function barChart(txs, selMonth, budget) {
    var tm = TODAY.slice(0, 7), end = selMonth > tm ? selMonth : (selMonth || tm), ms = [], i;
    for (i = 11; i >= 0; i--) ms.push(shiftMonth(end, -i));
    var vals = ms.map(function (m) { return Math.max(0, C.monthStats(txs, m).net); });
    var mx = Math.max.apply(null, vals.concat([budget || 0, 100])), W = 760, H = 250, pl = 52, pr = 8, pt = 24, pb = 34, bw = (W - pl - pr) / 12;
    var nice = niceMax(mx), y = function (v) { return pt + (H - pt - pb) * (1 - v / nice); }, s = '';
    for (i = 0; i <= 4; i++) { var gv = nice * i / 4; s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(gv) + '" y2="' + y(gv) + '" stroke="rgba(255,255,255,.09)"/>' + '<text x="' + (pl - 8) + '" y="' + (y(gv) + 3) + '" text-anchor="end" font-size="10" fill="#8fa6b2">' + (gv >= 1e6 ? (gv / 1e6).toFixed(1) + '万' : '¥' + Math.round(gv / 100).toLocaleString()) + '</text>'; }
    ms.forEach(function (m, k) {
      var x = pl + k * bw + bw * 0.18, w = bw * 0.64, v = vals[k], h = (H - pt - pb) * v / nice, sel = m === selMonth;
      var over = budget && v > budget;
      s += '<g data-act="mpick" data-m="' + m + '" style="cursor:pointer"><rect x="' + (pl + k * bw) + '" y="0" width="' + bw + '" height="' + H + '" fill="transparent"/>' +
        '<rect x="' + x + '" y="' + (y(0) - h) + '" width="' + w + '" height="' + Math.max(h, v ? 1 : 0) + '" fill="' + (over ? '#e39a7f' : sel ? '#e2eaf0' : '#5f93ac') + '" ' + (sel ? '' : 'opacity=".85"') + '><title>' + monthLabel(m) + '：' + fmt(v) + '</title></rect>' +
        '<text x="' + (x + w / 2) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="11" fill="' + (sel ? '#fff' : '#8fa6b2') + '">' + (+m.slice(5)) + '月</text>' +
        (v ? '<text x="' + (x + w / 2) + '" y="' + (y(0) - h - 6) + '" text-anchor="middle" font-size="10" fill="' + (sel ? '#fff' : '#a9bdc7') + '">' + (v >= 1e6 ? (v / 1e6).toFixed(1) + '万' : Math.round(v / 100)) + '</text>' : '') + '</g>';
    });
    if (budget) s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(budget) + '" y2="' + y(budget) + '" stroke="#e8c27a" stroke-dasharray="5 4"/><text x="' + pl + '" y="' + (y(budget) - 5) + '" font-size="10" fill="#e8c27a">月预算 ' + fmt(budget) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="近12个月净支出柱状图">' + s + '</svg>';
  }
  function niceMax(v) { var p = Math.pow(10, Math.floor(Math.log10(v))); var n = v / p; var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10; return m * p; }

  /* ---------- 视图：总览 ---------- */
  function emptyHero(title, p) { return '<div class="eyebrow">细水账 · XISHUI LEDGER</div><h1>' + title + '</h1><p>' + p + '</p>'; }
  function vOverview(list) {
    var txs = scoped(), m = curMonth(), st = C.monthStats(txs, m), pm = C.monthStats(txs, shiftMonth(m, -1)), sum = subSummary(list), hero = $('#hero');
    if (!S.txs.length && !S.manual.length) {
      hero.innerHTML = emptyHero('把账单倒进来，<br>看见每一笔<em style="font-style:normal;color:#8fb7cc">细水长流</em>', '导入支付宝、微信或银行导出的 CSV，自动识别每月、每周、每年重复的扣费，按月看支出、设预算、提前知道哪天会扣钱。全部在你的浏览器里完成，不上传、不注册、不收费。') +
        '<div class="btns" style="margin-top:26px;position:relative;z-index:1"><button class="btn light" data-act="pick">导入账单 CSV</button><button class="btn ghost-d" data-act="sample">载入示例数据（可一键清除）</button><button class="btn ghost-d" data-act="restorePick">从备份恢复</button></div>';
      $('#content').innerHTML = guideHTML();
      return;
    }
    var bt = C.budgetStatus(st.net, S.budget.total), delta = st.net - pm.net;
    hero.innerHTML = '<div class="eyebrow">OVERVIEW · ' + monthLabel(m) + ' 净支出</div>' +
      '<div class="hero-row"><div><h1 class="num">' + fmt(st.net) + '</h1><p>支出 ' + fmt(st.out) + (st.refund ? ' − 退款 ' + fmt(st.refund) : '') + ' · 共 ' + st.n + ' 笔' + (pm.net || pm.out ? ' · 较上月 ' + (delta >= 0 ? '多' : '少') + ' ' + fmt(Math.abs(delta)) : '') + (st.income ? ' · 收入（仅供参考）' + fmt(st.income) : '') + '</p>' + monthStepper() +
      (bt ? '<div class="hbar ' + bt.level + '"><div class="track"><div class="fill" style="width:' + Math.min(100, Math.round(bt.pct * 100)) + '%"></div></div><div class="cap"><span>月预算 ' + fmt(S.budget.total) + ' · 已用 ' + Math.round(bt.pct * 100) + '%</span><span>' + (bt.left >= 0 ? '还剩 ' + fmt(bt.left) : '超出 ' + fmt(-bt.left)) + '</span></div></div>' : '<div class="mini" style="margin-top:14px;color:#8fa6b2">还没设月预算，<a href="#" data-act="nav" data-v="budget" style="color:#9cc4d8">去设置</a></div>') +
      '</div><div class="hero-stats"><div class="hstat"><b class="num">' + fmt(sum.annual) + '</b><span>年化订阅成本（已确认 ' + sum.act.length + ' 项）</span></div><div class="hstat"><b>' + sum.pending.length + '</b><span>待确认的周期扣费</span></div></div></div>';
    var rm = reminders(list), cats = Object.keys(st.byCat).filter(function (c) { return st.byCat[c] !== 0; }).sort(function (a, b) { return st.byCat[b] - st.byCat[a]; });
    var tot = cats.reduce(function (s, c) { return s + Math.max(0, st.byCat[c]); }, 0) || 1;
    var mer = Object.keys(st.byMerchant).filter(function (k) { return st.byMerchant[k] > 0; }).sort(function (a, b) { return st.byMerchant[b] - st.byMerchant[a]; }).slice(0, 8);
    var upcoming = list.filter(function (x) { return x.st === 'confirmed' && x.due.s !== 'stopped' && x.next && x.due.d <= 30 && x.due.s !== 'late'; }).sort(function (a, b) { return a.next < b.next ? -1 : 1; });
    $('#content').innerHTML =
      (rm.length ? '<section class="sec"><div class="sec-h"><div><div class="idx">页面内提醒</div><h2>需要你留意的事 <span class="chip">' + rm.length + '</span></h2></div><span class="mini">仅在打开本页时显示，关闭浏览器不会提醒</span></div>' + rm.map(function (r) { return '<div class="alert ' + r.lv + '"><span class="ic">' + r.ic + '</span><div class="b">' + esc(r.t) + '<small>' + esc(r.s) + '</small></div><button class="btn sm" data-act="nav" data-v="' + r.go + '"' + (r.f ? ' data-f="' + r.f + '"' : '') + '>查看</button></div>'; }).join('') + '</section>' : '') +
      '<section class="sec"><div class="dark"><h3>近 12 个月净支出</h3><p class="sub">点击柱子切换月份。净支出 = 支出 − 退款（退款计入收到当月）。</p>' + barChart(txs, m, S.budget.total) + '</div></section>' +
      '<div class="grid2"><section class="sec"><div class="sec-h"><div><div class="idx">分类</div><h2>' + monthLabel(m) + '花在哪</h2></div><button class="btn sm" data-act="nav" data-v="rules">编辑分类规则</button></div>' +
      (cats.length ? cats.map(function (c) { var v = st.byCat[c], bud = S.budget.cats[c], bs = bud ? C.budgetStatus(v, bud) : null; return '<div class="cat"><div class="nm"><span class="sw" style="background:' + catColor(c) + '"></span>' + esc(c) + '</div><div class="bar"><i style="width:' + Math.max(0, Math.min(100, v / tot * 100)).toFixed(1) + '%;background:' + catColor(c) + '"></i></div><div class="v num">' + fmt(v) + '<small>' + (v > 0 ? (v / tot * 100).toFixed(1) + '%' : '净退款') + (bs ? (bs.level === 'over' ? ' · 超预算' : bs.level === 'warn' ? ' · 接近预算' : '') : '') + '</small></div></div>'; }).join('') : '<div class="empty">' + monthLabel(m) + '没有支出记录。</div>') + '</section>' +
      '<div><section class="sec"><div class="sec-h"><div><div class="idx">订阅</div><h2>30 天内将扣费</h2></div><button class="btn sm" data-act="nav" data-v="subs">全部订阅</button></div>' +
      (upcoming.length ? '<div class="list">' + upcoming.map(function (x) { return '<div class="li"><div><div class="t">' + esc(x.name) + '</div><div class="s">' + x.next + ' · ' + (x.due.d === 0 ? '今天' : x.due.d + ' 天后') + ' · ' + C.PERIODS[x.period].label + '</div></div><div class="r"><b class="num">' + fmt(x.amount) + '</b></div></div>'; }).join('') + '</div>' : '<div class="empty">' + (sum.act.length ? '30 天内没有已确认的订阅将扣费。' : '还没有已确认的订阅。去“订阅”页确认识别结果。') + '</div>') + '</section>' +
      '<section class="sec"><div class="sec-h"><div><div class="idx">商户</div><h2>本月支出前 8</h2></div></div>' + (mer.length ? '<div class="list">' + mer.map(function (k) { return '<div class="li"><div class="t">' + esc(k) + '</div><div class="r"><b class="num" style="font-size:18px">' + fmt(st.byMerchant[k]) + '</b></div></div>'; }).join('') + '</div>' : '<div class="empty">暂无</div>') + '</section></div></div>';
  }
  function guideHTML() {
    return '<section class="sec"><div class="sec-h"><div><div class="idx">三步开始</div><h2>怎么用</h2></div></div><div class="grid2e"><ol class="help"><li><b>导出账单</b>：支付宝 App → 我的 → 账单 → 右上角“···” → 开具交易流水证明 → 选 CSV；微信 → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单；银行网银/App 的“交易明细”导出 CSV。</li><li><b>导入</b>：在“数据”页拖入文件。支持支付宝（含 GBK 编码）、微信、招商银行、工商银行；其他格式用“手动映射列”。</li><li><b>确认</b>：“订阅”页会列出自动识别的周期扣费，你逐条确认或排除。</li></ol><div class="mini">不上传：所有解析都在你的浏览器里完成，页面没有任何网络请求。<br>不是记账 App 的替代品：它不接银行、不后台同步，关闭浏览器后不会推送提醒。支付宝/微信/银行流水里同一笔钱可能重复出现（如支付宝用银行卡付款），请用左下“账单范围”分开看。</div></div></section>';
  }

  /* ---------- 视图：流水 ---------- */
  function filterTx() {
    var f = UI.f, q = f.q.trim().toLowerCase();
    return scoped().filter(function (t) {
      if (f.month && t.date.slice(0, 7) !== f.month) return false;
      if (f.cat && t.cat !== f.cat) return false;
      if (f.kind === 'out' && t.k !== 'out') return false;
      if (f.kind === 'refund' && !(t.k === 'in' && t.r)) return false;
      if (f.kind === 'income' && !(t.k === 'in' && !t.r)) return false;
      if (f.kind === 'rv' && !(t.rv && !t.rvOk)) return false;
      if (f.kind === 'ig' && !t.ig) return false;
      if (q && (t.m + ' ' + t.d + ' ' + t.cat).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.time < b.time ? 1 : -1); });
  }
  function vTx() {
    var rows = filterTx(), ms = C.monthsOf(S.txs).reverse(), shown = rows.slice(0, UI.rows);
    var outSum = rows.filter(function (t) { return !t.ig && t.k === 'out'; }).reduce(function (s, t) { return s + t.c; }, 0), rf = rows.filter(function (t) { return !t.ig && t.k === 'in' && t.r; }).reduce(function (s, t) { return s + t.c; }, 0);
    $('#hero').innerHTML = '<div class="eyebrow">TRANSACTIONS</div><h1>流水 <small>' + rows.length + ' 笔</small></h1><p>当前筛选：支出 ' + fmt(outSum) + (rf ? '，退款 ' + fmt(rf) : '') + '，净 ' + fmt(outSum - rf) + '。可逐条改分类、标记“不计入”（如重复入账、自己转自己）。</p><div style="margin-top:14px;position:relative;z-index:1">' + scopeSel() + '</div>';
    $('#content').innerHTML = '<div class="tools"><input type="text" id="fq" placeholder="搜索商户/说明/分类" value="' + esc(UI.f.q) + '" aria-label="搜索">' +
      '<select data-act="fset" data-k="month" aria-label="月份"><option value="">全部月份</option>' + ms.map(function (m) { return '<option value="' + m + '"' + (UI.f.month === m ? ' selected' : '') + '>' + monthLabel(m) + '</option>'; }).join('') + '</select>' +
      '<select data-act="fset" data-k="cat" aria-label="分类"><option value="">全部分类</option>' + allCats().sort().map(function (c) { return '<option' + (UI.f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select data-act="fset" data-k="kind" aria-label="类型">' + [['', '全部类型'], ['out', '支出'], ['refund', '退款'], ['income', '收入'], ['rv', '待核对'], ['ig', '已忽略']].map(function (o) { return '<option value="' + o[0] + '"' + (UI.f.kind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      (shown.length ? '<table class="tbl"><thead><tr><th>日期</th><th>商户 / 说明</th><th>分类</th><th>来源</th><th class="amt">金额</th><th></th></tr></thead><tbody>' + shown.map(function (t) {
        return '<tr class="' + (t.ig ? 'ig' : '') + '"><td class="dt num">' + t.date + (t.time ? ' <span style="color:var(--muted)">' + t.time.slice(0, 5) + '</span>' : '') + '</td><td class="mm"><span class="m">' + esc(t.m) + '</span>' + (t.d && t.d !== t.m ? '<span class="d" title="' + esc(t.d) + '">' + esc(t.d) + '</span>' : '') + (t.rv && !t.rvOk ? '<span class="chip warn" title="' + esc(t.rv) + '" style="margin-top:2px">待核对</span> <button class="btn sm" data-act="rvok" data-id="' + t.id + '">已核对</button>' : '') + '</td><td class="ct"><select data-act="tcat" data-id="' + t.id + '" aria-label="分类">' + allCats().sort().map(function (c) { return '<option' + (c === t.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></td><td class="sr">' + (SRC_NAME[t.src] || t.src) + '</td><td class="amt num ' + (t.k === 'in' ? 'pos' : '') + '">' + (t.k === 'in' ? '+' : '') + fmt(t.c).replace('¥', '¥') + (t.k === 'in' ? '<br><span class="chip ' + (t.r ? 'info' : 'good') + '">' + (t.r ? '退款' : '收入') + '</span>' : '') + '</td><td class="ac"><button class="btn sm" data-act="tig" data-id="' + t.id + '">' + (t.ig ? '恢复' : '不计入') + '</button></td></tr>';
      }).join('') + '</tbody></table>' + (rows.length > shown.length ? '<div class="btns" style="margin-top:18px"><button class="btn" data-act="more">再显示 100 条（还有 ' + (rows.length - shown.length) + ' 条）</button></div>' : '') : '<div class="empty">没有符合条件的流水。</div>');
    var q = $('#fq'); q.addEventListener('input', function () { UI.f.q = q.value; UI.rows = 100; clearTimeout(vTx.t); vTx.t = setTimeout(function () { var p = q.selectionStart; vTx(); var n = $('#fq'); n.focus(); n.setSelectionRange(p, p); }, 250); });
  }

  /* ---------- 视图：订阅 ---------- */
  function candCard(x) {
    var c = x.cand, due = x.due;
    return '<div class="cand"><div class="cand-h"><h4>' + esc(x.name) + ' <span class="chip ' + (c && c.conf === 'high' ? 'good' : c && c.conf === 'low' ? 'warn' : 'info') + '">' + (c ? (c.conf === 'high' ? '把握较高' : c.conf === 'mid' ? '把握一般' : '把握较低·仅 ' + c.count + ' 次') : '') + '</span></h4><span class="amt num">' + fmt(x.amount) + ' <small style="font-size:13px;font-family:var(--sans);color:var(--muted)">/ ' + C.PERIODS[x.period].label.replace('每', '') + '</small></span></div>' +
      '<div class="meta"><span>' + C.PERIODS[x.period].label + ' · 已连续 ' + c.count + ' 期</span><span>最近一笔 ' + x.last + '</span><span>预计下次 ' + x.next + '</span><span>年化 ' + fmt(x.annual) + '</span><span>分类 ' + esc(x.cat) + '</span></div>' +
      (c.notes.length ? '<ul class="nt">' + c.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
      '<details><summary>查看识别依据（' + c.dates.length + ' 笔日期）</summary><div class="ev num">' + c.tx.map(function (id) { var t = S.txs.filter(function (z) { return z.id === id; })[0]; return t ? '<span>' + t.date + ' ' + fmt(t.c) + '</span>' : ''; }).join('') + '</div><div class="mini" style="margin-top:8px">规则：同一商户、金额在最近一笔 ±' + S.settings.tol + '%（至少 ¥1）以内、相邻两笔相隔约 1 个周期（周±1天 / 月±5天 / 年±7天），连续 ≥3 期（年付 ≥2 期）。</div></details>' +
      '<div class="btns"><button class="btn primary sm" data-act="sconf" data-k="' + esc(x.key) + '">确认是周期扣费</button><button class="btn sm" data-act="sexc" data-k="' + esc(x.key) + '">排除（不是）</button></div></div>';
  }
  function dueChip(x) {
    var d = x.due; if (x.st !== 'confirmed') return '';
    return d.s === 'today' ? '<span class="chip warn">今天扣费</span>' : d.s === 'soon' ? '<span class="chip info">' + d.d + ' 天后扣费</span>' : d.s === 'late' ? '<span class="chip warn">已过预计日 ' + d.d + ' 天</span>' : d.s === 'stopped' ? '<span class="chip over">疑似已停止（未计入年化）</span>' : '';
  }
  function vSubs(list) {
    var sum = subSummary(list), conf = list.filter(function (x) { return x.st === 'confirmed'; }).sort(function (a, b) { return b.annual - a.annual; }), pend = sum.pending, exc = list.filter(function (x) { return x.st === 'excluded' || x.st === 'canceled'; });
    // excluded decisions that aren't in the live candidate list
    var exKeys = Object.keys(S.subs).filter(function (k) { return S.subs[k].s === 'excluded' && !list.some(function (x) { return x.key === k; }); });
    $('#hero').innerHTML = '<div class="eyebrow">SUBSCRIPTIONS · 年化订阅成本</div><div class="hero-row"><div><h1 class="num">' + fmt(sum.annual) + '</h1><p>由你确认的 ' + sum.act.length + ' 项周期扣费折算成一年的总额（每周×52、每月×12、每年×1，按最近一次金额）。平均每月 ' + fmt(Math.round(sum.annual / 12)) + '。' + (sum.stopped.length ? '另有 ' + sum.stopped.length + ' 项疑似已停止的未计入（' + fmt(sum.stoppedAnnual) + '/年）。' : '') + '</p><div style="margin-top:14px">' + scopeSel() + '</div></div><div class="hero-stats"><div class="hstat"><b>' + pend.length + '</b><span>待确认</span></div><div class="hstat"><b>' + sum.act.filter(function (x) { return x.due.s === 'today' || x.due.s === 'soon'; }).length + '</b><span>' + S.settings.remind + ' 天内将扣费</span></div></div></div>';
    var h = '';
    h += '<section class="sec"><div class="sec-h"><div><div class="idx">待确认</div><h2>自动识别结果 <span class="chip">' + pend.length + '</span></h2></div><span class="mini">识别只是依据账单规律的猜测，请逐条确认或排除</span></div>' + (pend.length ? pend.map(candCard).join('') : '<div class="empty">' + (S.txs.length ? '没有待确认的识别结果。可到“数据”页导入更多月份的账单（至少连续 3 个月才能识别每月扣费），或在下方手动添加。' : '还没有账单数据。') + '</div>') + '</section>';
    h += '<section class="sec"><div class="sec-h"><div><div class="idx">已确认</div><h2>周期扣费清单 <span class="chip">' + conf.length + '</span></h2></div></div>' + (conf.length ? '<div class="list">' + conf.map(function (x) {
      return '<div class="li"><div><div class="t">' + esc(x.name) + ' ' + dueChip(x) + (x.stale ? ' <span class="chip">依据账单已删除</span>' : '') + (x.kind === 'manual' ? ' <span class="chip">手动</span>' : '') + '</div><div class="s">' + C.PERIODS[x.period].label + ' ' + fmt(x.amount) + (x.last ? ' · 最近 ' + x.last : '') + (x.next ? ' · 预计下次 ' + x.next : '') + ' · 分类 ' + esc(x.cat) + '</div><div class="btns" style="margin-top:6px">' + (x.kind === 'manual' ? '<button class="btn sm" data-act="madv" data-id="' + x.id + '">已扣费，顺延一期</button><button class="btn sm" data-act="mdel" data-id="' + x.id + '">删除</button>' : '') + '<button class="btn sm" data-act="scancel" data-k="' + esc(x.key) + '">标记已取消</button>' + (x.kind === 'auto' ? '<button class="btn sm" data-act="sback" data-k="' + esc(x.key) + '">改回待确认</button>' : '') + '</div></div><div class="r"><b class="num">' + fmt(x.annual) + '</b><div class="s">年化</div></div></div>';
    }).join('') + '</div>' : '<div class="empty">还没有已确认的周期扣费。</div>') + '</section>';
    h += '<div class="grid2e"><section class="sec"><div class="sec-h"><div><div class="idx">手动添加</div><h2>账单里没有的订阅</h2></div></div><form id="manualForm"><div class="row"><label class="f"><span>名称</span><input type="text" name="name" required maxlength="40" placeholder="如：年度域名"></label><label class="f"><span>金额（元）</span><input type="number" name="amt" required min="0.01" step="0.01"></label></div><div class="row"><label class="f"><span>周期</span><select name="period"><option value="month">每月</option><option value="year">每年</option><option value="week">每周</option></select></label><label class="f"><span>下次扣费日</span><input type="date" name="next" required value="' + C.addDays(TODAY, 7) + '"></label></div><button class="btn primary" type="submit">添加</button></form></section>' +
      '<section class="sec"><div class="sec-h"><div><div class="idx">设置</div><h2>识别与提醒</h2></div></div><label class="f"><span>金额相近容差（%）：与最近一笔相差不超过该比例（至少 ¥1）才算同一订阅</span><input type="number" id="setTol" min="0" max="50" step="1" value="' + S.settings.tol + '"></label><label class="f"><span>提前几天提醒扣费</span><select id="setRemind">' + [1, 3, 7, 14, 30].map(function (d) { return '<option value="' + d + '"' + (S.settings.remind === d ? ' selected' : '') + '>' + d + ' 天</option>'; }).join('') + '</select></label><p class="mini">提醒只在你打开本页时显示；本工具没有后台，关闭浏览器不会通知。想要系统级提醒，请把“预计下次扣费日”手动加进手机日历。</p></section></div>';
    if (exc.length || exKeys.length) h += '<section class="sec"><div class="sec-h"><div><div class="idx">已排除 / 已取消</div><h2>不计入的项目</h2></div></div><div class="list">' + exc.map(function (x) { return '<div class="li"><div><div class="t">' + esc(x.name) + ' <span class="chip">' + (x.st === 'canceled' ? '已取消' : '已排除') + '</span></div><div class="s">' + C.PERIODS[x.period].label + ' ' + fmt(x.amount) + '</div></div><div class="btns"><button class="btn sm" data-act="sback" data-k="' + esc(x.key) + '">改回待确认</button></div></div>'; }).join('') + exKeys.map(function (k) { return '<div class="li"><div><div class="t">' + esc(k.split('|')[0]) + ' <span class="chip">已排除</span></div></div><div class="btns"><button class="btn sm" data-act="sback" data-k="' + esc(k) + '">改回待确认</button></div></div>'; }).join('') + '</div></section>';
    $('#content').innerHTML = h;
    var mf = $('#manualForm'); if (mf) mf.addEventListener('submit', function (e) {
      e.preventDefault(); var f = mf.elements, amt = C.toCents(f.amt.value); if (!amt || amt <= 0 || !f.next.value) return toast('请填写金额和日期');
      S.manual.push({ id: S.seq++, name: f.name.value.trim(), amount: amt, period: f.period.value, next: f.next.value, cat: '订阅会员' }); save(); render(); toast('已添加');
    });
    $('#setTol').addEventListener('change', function (e) { var v = Math.max(0, Math.min(50, +e.target.value || 0)); S.settings.tol = v; save(); render(); });
    $('#setRemind').addEventListener('change', function (e) { S.settings.remind = +e.target.value; save(); render(); });
  }

  /* ---------- 视图：预算 ---------- */
  function vBudget() {
    var m = curMonth(), st = C.monthStats(scoped(), m), cats = allCats().sort(function (a, b) { return (st.byCat[b] || 0) - (st.byCat[a] || 0); }), bt = C.budgetStatus(st.net, S.budget.total);
    $('#hero').innerHTML = '<div class="eyebrow">BUDGET · ' + monthLabel(m) + '</div><h1>月度预算</h1><p>设一个总预算，再给想盯紧的分类各设一个。用到 80% 会提醒，超过会标红。预算每月相同，按你选中的月份对比。</p>' + monthStepper();
    $('#content').innerHTML = '<div class="grid2"><section class="sec"><div class="sec-h"><div><div class="idx">总预算</div><h2>' + monthLabel(m) + '</h2></div></div><div class="row" style="align-items:flex-end"><label class="f"><span>每月总预算（元，留空表示不设）</span><input type="number" id="bTotal" min="0" step="0.01" value="' + (S.budget.total ? yuan(S.budget.total) : '') + '"></label></div>' +
      (bt ? '<div class="alert ' + (bt.level === 'ok' ? 'info' : bt.level) + '"><span class="ic">' + (bt.level === 'ok' ? '✓' : '!') + '</span><div class="b">已花 ' + fmt(st.net) + '（' + Math.round(bt.pct * 100) + '%）<small>' + (bt.left >= 0 ? '本月还剩 ' + fmt(bt.left) : '本月已超出 ' + fmt(-bt.left)) + '</small></div></div>' : '') +
      '<div class="sec-h" style="margin-top:30px"><div><div class="idx">分类预算</div><h2>按分类盯紧</h2></div></div>' + cats.map(function (c) { var b = S.budget.cats[c], v = st.byCat[c] || 0, s = b ? C.budgetStatus(v, b) : null; return '<div class="rule-row" style="grid-template-columns:110px 1fr 130px"><span><i class="sw" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + catColor(c) + ';margin-right:8px"></i>' + esc(c) + '</span><span class="mini">本月 ' + fmt(v) + (s ? ' · ' + (s.level === 'over' ? '<b style="color:var(--over)">超出 ' + fmt(-s.left) + '</b>' : s.level === 'warn' ? '<b style="color:var(--warn)">已用 ' + Math.round(s.pct * 100) + '%</b>' : '已用 ' + Math.round(s.pct * 100) + '%') : '') + '</span><input type="number" min="0" step="0.01" data-cb="' + esc(c) + '" placeholder="不设" value="' + (b ? yuan(b) : '') + '" aria-label="' + esc(c) + ' 预算"></div>'; }).join('') + '</section>' +
      '<section class="sec"><div class="dark"><h3>怎么算的</h3><p class="sub" style="margin-top:8px">月支出 = 当月所有支出 − 当月收到的退款。不含收入、转账/充值/还款等“不计收支”、交易关闭的订单、以及你在“流水”里标记“不计入”的记录。<br><br>分类取自“规则”页：关键词按顺序匹配，匹配不到才用账单自带的分类，再不行归入“未分类”。</p></div></section></div>';
    $('#bTotal').addEventListener('change', function (e) { var c = C.toCents(e.target.value); S.budget.total = c && c > 0 ? c : null; save(); render(); });
    document.querySelectorAll('[data-cb]').forEach(function (i) { i.addEventListener('change', function () { var c = C.toCents(i.value); if (c && c > 0) S.budget.cats[i.dataset.cb] = c; else delete S.budget.cats[i.dataset.cb]; save(); render(); }); });
  }

  /* ---------- 视图：规则 ---------- */
  function vRules() {
    $('#hero').innerHTML = '<div class="eyebrow">CATEGORY RULES</div><h1>分类规则</h1><p>每条规则：只要“商户 + 商品说明 + 账单原分类”里包含任一关键词（不分大小写），就归入该分类。从上到下，先匹配到的生效。你在“流水”里手动改过分类的记录不会被覆盖。</p>';
    $('#content').innerHTML = '<section class="sec"><div class="sec-h"><div><div class="idx">规则列表</div><h2>' + S.rules.length + ' 条</h2></div><div class="btns"><button class="btn" data-act="radd">+ 新规则</button><button class="btn primary" data-act="rapply">保存并重新分类</button></div></div><div id="ruleList">' + S.rules.map(function (r, i) {
      return '<div class="rule-row" data-i="' + i + '"><input type="text" value="' + esc(r.cat) + '" data-rc aria-label="分类名" placeholder="分类名"><input type="text" value="' + esc(r.kw.join('，')) + '" data-rk aria-label="关键词" placeholder="关键词，用逗号分隔"><span class="ctl"><button class="btn sm" data-act="rup" data-i="' + i + '" aria-label="上移">↑</button><button class="btn sm" data-act="rdn" data-i="' + i + '" aria-label="下移">↓</button><button class="btn sm danger" data-act="rdel" data-i="' + i + '" aria-label="删除">删</button></span></div>';
    }).join('') + '</div><p class="mini" style="margin-top:14px">例：分类“餐饮”，关键词“美团，饿了么，咖啡”。改完点“保存并重新分类”。<button class="btn sm" data-act="rreset" style="margin-left:8px">恢复默认规则</button></p></section>';
  }
  function readRules() {
    var rows = document.querySelectorAll('#ruleList .rule-row'), out = [];
    rows.forEach(function (r) { var cat = r.querySelector('[data-rc]').value.trim(), kw = r.querySelector('[data-rk]').value.split(/[,，、;；\n]/).map(function (x) { return x.trim(); }).filter(Boolean); if (cat) out.push({ cat: cat, kw: kw }); });
    return out;
  }
  function reclassify() { var n = 0; S.txs.forEach(function (t) { if (t.catManual) return; var c = C.categorize(t, S.rules); if (c !== t.cat) { t.cat = c; n++; } }); return n; }

  /* ---------- 视图：数据 ---------- */
  function vData() {
    $('#hero').innerHTML = '<div class="eyebrow">DATA · IMPORT & BACKUP</div><h1>数据</h1><p>导入账单、导出备份。所有数据只在这台设备的浏览器里，页面不联网。共 ' + S.txs.length + ' 笔流水，' + S.batches.length + ' 个导入批次。</p>';
    var h = '<section class="sec"><div class="dark"><h3>导入账单 CSV</h3><p class="sub">支持：支付宝（新/旧版）、微信支付、招商银行流水、工商银行明细；其他格式可“手动映射列”。可一次选多个文件。重复导入同一文件不会重复入账。</p><div class="drop" id="drop"><b>拖入 CSV 文件</b><button class="btn light" data-act="pick" style="margin-top:12px">或选择文件</button></div></div></section>';
    h += '<div id="pvs">' + UI.pv.map(pvHTML).join('') + '</div>';
    h += '<section class="sec"><div class="sec-h"><div><div class="idx">批次</div><h2>已导入的文件</h2></div></div>' + (S.batches.length ? '<div class="list">' + S.batches.map(function (b) { return '<div class="li"><div><div class="t">' + esc(b.name) + ' <span class="chip">' + (SRC_NAME[b.src] || b.src) + '</span>' + (b.sample ? ' <span class="chip warn">示例数据</span>' : '') + '</div><div class="s">' + b.at + ' 导入 · ' + b.count + ' 笔 · ' + (b.range || '') + (b.dup ? ' · 跳过重复 ' + b.dup : '') + '</div></div><div class="btns"><button class="btn sm danger" data-act="bdel" data-id="' + b.id + '">删除此批</button></div></div>'; }).join('') + '</div>' : '<div class="empty">还没有导入。</div>') + '</section>';
    h += '<div class="grid2e"><section class="sec"><div class="sec-h"><div><div class="idx">导出</div><h2>CSV / JSON</h2></div></div><div class="btns"><button class="btn" data-act="exTx">流水 CSV</button><button class="btn" data-act="exSub">订阅 CSV</button><button class="btn primary" data-act="exJson">完整备份 JSON</button></div><p class="mini" style="margin-top:12px">CSV 带 UTF-8 BOM，Excel 可直接打开。完整备份包含流水、规则、预算、订阅确认结果，可在任意设备的本页恢复。上次备份：' + (S.lastBackup || '从未') + '</p></section>' +
      '<section class="sec"><div class="sec-h"><div><div class="idx">恢复</div><h2>从备份导入</h2></div></div><div class="btns"><button class="btn" data-act="restorePick">选择备份 JSON</button><button class="btn danger" data-act="clear">清空全部数据</button></div><p class="mini" style="margin-top:12px">恢复时可选“覆盖”或“合并”（合并：只补充本机没有的流水，保留你当前的规则和预算）。</p></section></div>';
    h += '<section class="sec"><div class="sec-h"><div><div class="idx">说明</div><h2>已知限制，如实告知</h2></div></div><ul class="help"><li>列名依据公开资料核对：支付宝（交易时间、交易分类、交易对方、商品说明、收/支、金额、交易状态…，GBK 编码）、微信（交易时间、交易类型、交易对方、商品、收/支、金额(元)、当前状态…）、招商银行（记账日期、货币、交易金额、联机余额、交易摘要、对手信息）、工商银行（交易日期、摘要、交易场所、记账金额(收入/支出)、对方户名…）。银行可能改版；认不出就用“手动映射列”。建设银行等其它银行没有核对到稳定的公开列名，请用手动映射。</li><li>银行流水里经“快捷支付”的消费，商户常显示为“待清算…专户”，无法知道真实商户，这类记录不参与订阅识别。</li><li>支付宝/微信与银行卡流水会对同一笔消费各记一次，同时导入会重复，请用“账单范围”分开看。</li><li>退款按“收到退款的当月”冲减；同额退款会与原支出配对后一并排除出订阅识别。</li><li>只处理人民币；外币行会被跳过并提示。</li><li>周期扣费是规律推测，不保证一定是订阅；年付至少需 2 年数据；未连续 3 期的月付不会被识别。</li><li>数据在浏览器的 IndexedDB 里，换设备/清缓存会丢失；关闭浏览器不会有任何提醒。</li></ul></section>';
    $('#content').innerHTML = h;
    var dz = $('#drop');
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
  }

  /* ---------- 导入流程 ---------- */
  function decodeBuf(buf) {
    var u8 = new Uint8Array(buf);
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), enc: 'UTF-8' }; } catch (e) { }
    try { return { text: new TextDecoder('gb18030').decode(u8), enc: 'GBK/GB18030' }; } catch (e2) { return { text: new TextDecoder('utf-8').decode(u8), enc: 'UTF-8(宽松)' }; }
  }
  function handleFiles(files) {
    files = Array.prototype.slice.call(files); if (!files.length) return;
    UI.view = 'data';
    Promise.all(files.map(function (f) { return f.arrayBuffer().then(function (b) { return { name: f.name, buf: b }; }); })).then(function (fs) {
      fs.forEach(function (f) { addPreview(f.name, decodeBuf(f.buf)); });
      render(); toast('已读取 ' + fs.length + ' 个文件，请核对后确认导入');
    });
  }
  function addPreview(name, dec) {
    var rows = C.parseCSV(dec.text);
    if (rows.length < 2 && dec.text.indexOf('\t') > 0) rows = C.parseCSV(dec.text, '\t');
    var det = C.detect(rows), pv = { id: S.seq++, name: name, rows: rows, enc: dec.enc, det: det, mapping: null, manual: false };
    if (!det) { var g = C.guessMapping(rows); pv.mapping = g.mapping; pv.guessOK = g.ok; pv.det = { fmt: 'generic', hi: g.mapping.hi, label: '通用 CSV（未识别为已知格式）' }; pv.manual = true; }
    runPreview(pv); UI.pv.push(pv);
  }
  function runPreview(pv) {
    var r = C.normalize(pv.rows, pv.det, pv.mapping); pv.r = r;
    var occ = {}, ex = {}; S.txs.forEach(function (t) { ex[t.key] = 1; });
    pv.newRecs = []; pv.dup = 0;
    r.recs.forEach(function (x) { var b = C.baseKey(x); occ[b] = (occ[b] || 0) + 1; x.key = b + '@' + occ[b]; if (ex[x.key]) pv.dup++; else pv.newRecs.push(x); });
    var ds = r.recs.map(function (x) { return x.date; }).sort(); pv.range = ds.length ? ds[0] + ' ~ ' + ds[ds.length - 1] : '';
    var os = {}; S.txs.forEach(function (t) { if (t.src !== (r.recs[0] && r.recs[0].src)) os[t.src] = 1; }); pv.otherSrc = Object.keys(os);
  }
  function sumOf(a, f) { return a.filter(f).reduce(function (s, x) { return s + x.c; }, 0); }
  function pvHTML(pv) {
    var r = pv.r, nr = pv.newRecs, out = nr.filter(function (x) { return x.k === 'out'; }), rf = nr.filter(function (x) { return x.k === 'in' && x.r; }), inc = nr.filter(function (x) { return x.k === 'in' && !x.r; });
    var allOut = r.recs.filter(function (x) { return x.k === 'out'; });
    var chk = '';
    if (r.declared && r.declared['支出']) { var d = r.declared['支出']; var okc = d.n === allOut.length && d.c === sumOf(allOut, function () { return true; }); chk = '<div class="mini ' + (okc ? 'ok' : 'warnc') + '">与文件头自带统计核对：文件声明支出 ' + d.n + ' 笔 / ' + fmt(d.c) + '；本次解析 ' + allOut.length + ' 笔 / ' + fmt(sumOf(allOut, function () { return true; })) + (okc ? ' —— 一致 ✓' : ' —— 不一致。平台说明里提到统计口径可能不同，请抽查几笔。') + '</div>'; }
    var sk = Object.keys(r.skipped).map(function (k) { return esc(k) + ' ' + r.skipped[k] + ' 条'; }).join('；');
    var rv = r.recs.filter(function (x) { return x.rv; }).length;
    var head = pv.rows[pv.det.hi] || [];
    var h = '<div class="pv" data-pv="' + pv.id + '"><h4>' + esc(pv.name) + ' <span class="chip info">' + esc(pv.det.label) + '</span></h4><div class="mini">编码 ' + pv.enc + ' · 文件共 ' + pv.rows.length + ' 行 · 表头在第 ' + (pv.det.hi + 1) + ' 行</div>' +
      '<div class="kv num"><span>将导入 <b>' + nr.length + '</b> 笔</span><span>支出 <b>' + out.length + '</b> 笔 ' + fmt(sumOf(out, function () { return true; })) + '</span><span>退款 <b>' + rf.length + '</b> 笔 ' + fmt(sumOf(rf, function () { return true; })) + '</span><span>收入 <b>' + inc.length + '</b> 笔 ' + fmt(sumOf(inc, function () { return true; })) + '</span><span>日期 ' + (pv.range || '—') + '</span></div>' +
      (pv.dup ? '<div class="mini warnc">已存在而跳过的重复记录：' + pv.dup + ' 笔</div>' : '') + (sk ? '<div class="mini">已排除（不计入收支）：' + sk + '</div>' : '') + (r.bad ? '<div class="mini bad">无法解析的行：' + r.bad + ' 行（日期或金额格式不对，未导入）</div>' : '') + (rv ? '<div class="mini warnc">其中 ' + rv + ' 笔带“待核对”提示，导入后可在流水里筛选。</div>' : '') + chk +
      (pv.otherSrc.length && r.recs.length ? '<div class="mini warnc">注意：你已导入过其他来源（' + pv.otherSrc.map(function (s) { return SRC_NAME[s] || s; }).join('、') + '）。同一笔消费可能在两边各出现一次，合计会偏高；建议用左侧“账单范围”分开看。</div>' : '') +
      (pv.mapping === null || pv.det.fmt !== 'generic' ? '' : '') +
      '<table class="pvt num"><tr><th>日期</th><th>商户</th><th>说明</th><th>方向</th><th>金额</th></tr>' + nr.slice(0, 6).map(function (x) { return '<tr><td>' + x.date + '</td><td>' + esc(x.m).slice(0, 18) + '</td><td>' + esc(x.d).slice(0, 18) + '</td><td>' + (x.k === 'out' ? '支出' : x.r ? '退款' : '收入') + '</td><td>' + fmt(x.c) + '</td></tr>'; }).join('') + '</table><div class="mini">仅显示前 6 条预览。</div>';
    if (pv.manual || pv.showMap) {
      var m = pv.mapping, opt = function (sel) { return '<option value="-1">（无）</option>' + head.map(function (c, i) { return '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + (i + 1) + '：' + esc(c || '（空）') + '</option>'; }).join(''); };
      h += '<div class="sec-h" style="margin-top:14px"><h2 style="font-size:16px">手动映射列</h2></div>' + (pv.guessOK === false ? '<div class="mini bad">没能自动识别列名，请在下面指定每一列。</div>' : '<div class="mini">已按列名自动猜测，请核对。</div>') +
        '<div class="row" style="margin-top:8px"><label class="f"><span>表头在第几行</span><input type="number" min="1" data-m="hi" value="' + (m.hi + 1) + '"></label><label class="f"><span>日期列</span><select data-m="date">' + opt(m.date) + '</select></label><label class="f"><span>商户/对方列</span><select data-m="merchant">' + opt(m.merchant) + '</select></label><label class="f"><span>说明列（可选）</span><select data-m="desc">' + opt(m.desc) + '</select></label></div>' +
        '<div class="row"><label class="f"><span>金额与方向怎么判断</span><select data-m="sign"><option value="dir"' + (m.sign === 'dir' ? ' selected' : '') + '>金额列 + “收/支”列</option><option value="neg-out"' + (m.sign === 'neg-out' ? ' selected' : '') + '>负数是支出、正数是收入</option><option value="pos-out"' + (m.sign === 'pos-out' ? ' selected' : '') + '>正数是支出、负数是收入</option><option value="split"' + (m.sign === 'split' ? ' selected' : '') + '>收入、支出分两列</option></select></label>' +
        (m.sign === 'split' ? '<label class="f"><span>收入列</span><select data-m="inCol">' + opt(m.inCol) + '</select></label><label class="f"><span>支出列</span><select data-m="outCol">' + opt(m.outCol) + '</select></label>' : '<label class="f"><span>金额列</span><select data-m="amount">' + opt(m.amount) + '</select></label>' + (m.sign === 'dir' ? '<label class="f"><span>收/支列</span><select data-m="dir">' + opt(m.dir) + '</select></label>' : '')) + '</div>';
    }
    h += '<div class="btns" style="margin-top:12px"><button class="btn primary" data-act="pvok" data-id="' + pv.id + '"' + (nr.length ? '' : ' disabled') + '>确认导入 ' + nr.length + ' 笔</button>' + (pv.manual || pv.showMap ? '' : '<button class="btn" data-act="pvmap" data-id="' + pv.id + '">手动映射列</button>') + '<button class="btn" data-act="pvno" data-id="' + pv.id + '">取消</button></div></div>';
    return h;
  }
  function commitPreview(pv, sample) {
    var bid = 'b' + S.seq++, n = 0, srcs = {};
    pv.newRecs.forEach(function (x) {
      var t = { id: 't' + (S.seq++), date: x.date, time: x.time, m: x.m || '（无名称）', d: x.d || '', c: x.c, k: x.k, r: !!x.r, src: x.src, sc: x.sc || '', ref: x.ref || '', key: x.key, b: bid };
      if (x.op) t.op = 1; if (x.rv) t.rv = x.rv;
      t.cat = C.categorize(t, S.rules); S.txs.push(t); n++; srcs[x.src] = 1;
    });
    S.batches.push({ id: bid, name: pv.name, src: Object.keys(srcs)[0] || (pv.r.recs[0] && pv.r.recs[0].src) || 'csv', at: TODAY, count: n, dup: pv.dup, range: pv.range, sample: !!sample });
    S.txs.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return n;
  }

  /* ---------- 导出 / 备份 ---------- */
  function exportTx() {
    var rows = [['日期', '时间', '方向', '金额(元)', '商户', '说明', '分类', '来源', '是否计入']];
    S.txs.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) { rows.push([t.date, t.time, t.k === 'out' ? '支出' : t.r ? '退款' : '收入', yuan(t.c), t.m, t.d, t.cat, SRC_NAME[t.src] || t.src, t.ig ? '否' : '是']); });
    download('细水账-流水-' + TODAY + '.csv', '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function exportSubs() {
    var rows = [['名称', '状态', '周期', '金额(元)', '年化(元)', '最近一笔', '预计下次', '分类', '来源']];
    computeSubs().forEach(function (x) { rows.push([x.name, { confirmed: '已确认', pending: '待确认', excluded: '已排除', canceled: '已取消' }[x.st], C.PERIODS[x.period].label, yuan(x.amount), yuan(x.annual), x.last || '', x.next || '', x.cat, x.kind === 'manual' ? '手动' : '自动识别']); });
    download('细水账-订阅-' + TODAY + '.csv', '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function exportJson() {
    S.lastBackup = TODAY; save();
    download('细水账-备份-' + TODAY + '.json', JSON.stringify({ app: 'xishui-caiwu', version: 1, exportedAt: new Date().toISOString(), data: S }, null, 1), 'application/json');
    render();
  }
  function restoreFrom(text) {
    var o; try { o = JSON.parse(text); } catch (e) { return toast('不是有效的 JSON 文件'); }
    if (!o || o.app !== 'xishui-caiwu' || !o.data || !Array.isArray(o.data.txs)) return toast('这不是细水账的备份文件');
    var d = o.data, replace = confirm('备份内含 ' + d.txs.length + ' 笔流水。\n\n点“确定” = 覆盖：用备份替换本机全部数据。\n点“取消” = 进入“合并”选项。');
    if (replace) { S = Object.assign(freshState(), d); UI.pv = []; save(); render(); return toast('已覆盖恢复'); }
    if (!confirm('合并：只补充本机没有的流水，保留当前的规则、预算和订阅确认结果。继续？')) return toast('已取消');
    var ex = {}; S.txs.forEach(function (t) { ex[t.key] = 1; }); var n = 0, bmap = {};
    d.txs.forEach(function (t) { if (ex[t.key]) return; t.id = 't' + (S.seq++); t.cat = t.cat || C.categorize(t, S.rules); S.txs.push(t); n++; bmap[t.b] = 1; });
    (d.batches || []).forEach(function (b) { if (bmap[b.id] && !S.batches.some(function (x) { return x.id === b.id; })) S.batches.push(b); });
    Object.keys(d.subs || {}).forEach(function (k) { if (!S.subs[k]) S.subs[k] = d.subs[k]; });
    S.txs.sort(function (a, b) { return a.date < b.date ? -1 : 1; }); save(); render(); toast('已合并 ' + n + ' 笔');
  }

  /* ---------- 事件 ---------- */
  function byId(id) { return S.txs.filter(function (t) { return t.id === id; })[0]; }
  function setSub(k, st, extra) {
    var list = computeSubs(), x = list.filter(function (z) { return z.key === k; })[0], prev = S.subs[k];
    var snap = x ? { name: x.name, period: x.period, amount: x.amount, next: x.next, last: x.last, cat: x.cat } : (prev && prev.snap);
    if (st === 'pending') delete S.subs[k]; else S.subs[k] = { s: st, snap: snap };
    save(); render();
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT') return;
    var a = el.dataset.act, id = el.dataset.id, k = el.dataset.k;
    if (a === 'nav') { e.preventDefault(); UI.view = el.dataset.v; if (el.dataset.f) UI.f.kind = el.dataset.f; window.scrollTo(0, 0); return render(); }
    if (a === 'pick') return $('#fileIn').click();
    if (a === 'restorePick') return $('#restoreIn').click();
    if (a === 'mprev') { UI.month = shiftMonth(curMonth(), -1); return render(); }
    if (a === 'mnext') { UI.month = shiftMonth(curMonth(), 1); return render(); }
    if (a === 'mpick') { UI.month = el.dataset.m; return render(); }
    if (a === 'more') { UI.rows += 100; return vTx(); }
    if (a === 'tig') { var t = byId(id); t.ig = !t.ig; save(); return render(); }
    if (a === 'rvok') { byId(id).rvOk = 1; save(); return render(); }
    if (a === 'sconf') return setSub(k, 'confirmed');
    if (a === 'sexc') return setSub(k, 'excluded');
    if (a === 'scancel') { if (k.indexOf('m:') === 0) { S.manual.filter(function (m) { return 'm:' + m.id === k; })[0].canceled = true; save(); return render(); } return setSub(k, 'canceled'); }
    if (a === 'sback') { if (k.indexOf('m:') === 0) { S.manual.filter(function (m) { return 'm:' + m.id === k; })[0].canceled = false; save(); return render(); } delete S.subs[k]; save(); return render(); }
    if (a === 'mdel') { if (!confirm('删除这个手动订阅？')) return; S.manual = S.manual.filter(function (m) { return String(m.id) !== id; }); save(); return render(); }
    if (a === 'madv') { var m = S.manual.filter(function (z) { return String(z.id) === id; })[0]; m.next = m.period === 'week' ? C.addDays(m.next, 7) : C.addMonthsAnchor(m.next, m.period === 'month' ? 1 : 12, +m.next.slice(8)); save(); return render(); }
    if (a === 'radd') { S.rules = readRules(); S.rules.push({ cat: '', kw: [] }); render(); var ins = document.querySelectorAll('#ruleList [data-rc]'); return ins[ins.length - 1].focus(); }
    if (a === 'rdel') { S.rules = readRules(); S.rules.splice(+el.dataset.i, 1); return render(); }
    if (a === 'rup' || a === 'rdn') { S.rules = readRules(); var i = +el.dataset.i, j = a === 'rup' ? i - 1 : i + 1; if (j >= 0 && j < S.rules.length) { var tmp = S.rules[i]; S.rules[i] = S.rules[j]; S.rules[j] = tmp; } return render(); }
    if (a === 'rapply') { S.rules = readRules(); var n = reclassify(); save(); render(); return toast('规则已保存，重新分类了 ' + n + ' 笔'); }
    if (a === 'rreset') { if (!confirm('恢复默认规则？你自定义的规则会丢失。')) return; S.rules = JSON.parse(JSON.stringify(C.DEFAULT_RULES)); reclassify(); save(); return render(); }
    if (a === 'pvok') { var pv = UI.pv.filter(function (p) { return String(p.id) === id; })[0]; var cnt = commitPreview(pv); UI.pv = UI.pv.filter(function (p) { return p !== pv; }); save(); render(); return toast('已导入 ' + cnt + ' 笔'); }
    if (a === 'pvno') { UI.pv = UI.pv.filter(function (p) { return String(p.id) !== id; }); return render(); }
    if (a === 'pvmap') { var p2 = UI.pv.filter(function (p) { return String(p.id) === id; })[0]; var g = C.guessMapping(p2.rows); g.mapping.hi = p2.det.hi; p2.mapping = g.mapping; p2.guessOK = g.ok; p2.det = { fmt: 'generic', hi: g.mapping.hi, label: '通用 CSV（手动映射）' }; p2.manual = true; runPreview(p2); return render(); }
    if (a === 'bdel') { var b = S.batches.filter(function (x) { return x.id === id; })[0]; if (!confirm('删除批次“' + b.name + '”及其 ' + b.count + ' 笔流水？（你对这些流水做的分类修改也会一起删除）')) return; S.txs = S.txs.filter(function (t) { return t.b !== id; }); S.batches = S.batches.filter(function (x) { return x.id !== id; }); save(); return render(); }
    if (a === 'exTx') return exportTx();
    if (a === 'exSub') return exportSubs();
    if (a === 'exJson') return exportJson();
    if (a === 'clear') { if (!confirm('清空本机全部数据（流水、规则、预算、订阅确认）？此操作不可撤销，建议先导出备份。')) return; S = freshState(); UI.pv = []; save(); render(); return toast('已清空'); }
    if (a === 'sample') { var pv2 = { id: S.seq++, name: '示例账单（模拟数据）.csv', rows: C.parseCSV(window.SAMPLE_CSV), enc: 'UTF-8' }; pv2.det = C.detect(pv2.rows); runPreview(pv2); commitPreview(pv2, true); save(); UI.view = 'overview'; render(); return toast('已载入模拟数据，可在“数据”页删除该批次'); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target, a = el.dataset && el.dataset.act;
    if (el.id === 'fileIn') { handleFiles(el.files); el.value = ''; return; }
    if (el.id === 'restoreIn') { var f = el.files[0]; if (f) f.text().then(restoreFrom); el.value = ''; return; }
    if (a === 'scope') { UI.scope = el.value; return render(); }
    if (a === 'mset') { UI.month = el.value; return render(); }
    if (a === 'fset') { UI.f[el.dataset.k] = el.value; UI.rows = 100; return vTx(); }
    if (a === 'tcat') { var t = byId(el.dataset.id); t.cat = el.value; t.catManual = 1; save(); return render(); }
    if (el.dataset && el.dataset.m) {
      var pv = UI.pv.filter(function (p) { return p.id === +el.closest('[data-pv]').dataset.pv; })[0], m = pv.mapping, key = el.dataset.m;
      if (key === 'hi') { m.hi = Math.max(0, (+el.value || 1) - 1); pv.det.hi = m.hi; } else if (key === 'sign') { m.sign = el.value; } else m[key] = +el.value;
      runPreview(pv); render();
    }
  });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { if (!e.target.closest('#drop')) e.preventDefault(); });

  /* ---------- 启动 ---------- */
  openDB().then(dbGet).then(function (d) {
    if (d && d.txs) S = Object.assign(freshState(), d);
    if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) { } }
    render();
    window.__xishui = { S: function () { return S; }, UI: UI, render: render };
  });
})();
