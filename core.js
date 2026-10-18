/* 细水账 core —— 纯函数：CSV 解析、账单格式识别、周期扣费识别、月度汇总。
   所有金额用“整数分”，避免浮点误差。可在浏览器与 Node 中运行（tests/run-core.js 用 Node 自测）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 基础工具 ---------- */
  function parseCSV(text, delim) {
    delim = delim || ',';
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], cur = '', q = false, i = 0, n = text.length, c;
    while (i < n) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
        cur += c; i++; continue;
      }
      if (c === '"' && cur.trim() === '') { q = true; cur = ''; i++; continue; }
      if (c === delim) { row.push(cur); cur = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += c; i++;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.map(function (r) { return r.map(function (x) { return x.replace(/^[\s\u00a0\u3000]+|[\s\u00a0\u3000]+$/g, ''); }); });
  }

  function toCents(s) {
    if (s == null) return null;
    s = String(s).replace(/[\s\u00a0¥￥,，元$]/g, '').replace(/^'+/, '');
    if (s === '' || s === '-' || s === '/') return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s[0] === '+') s = s.slice(1);
    if (s[0] === '-' || s[0] === '－') { neg = !neg; s = s.slice(1); }
    var m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return null;
    var frac = (m[2] || '') + '000', cents = parseInt(frac.slice(0, 2), 10);
    var whole = parseInt(m[1], 10) * 100 + cents;
    if (parseInt(frac[2], 10) >= 5) whole += 1;   // 超过两位小数时四舍五入
    return neg ? -whole : whole;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function validYMD(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m); }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function parseDate(s) {
    if (s == null) return null;
    s = String(s).trim();
    var m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (!m) { m = /^(\d{4})(\d{2})(\d{2})(?:\s*(\d{2}):?(\d{2}):?(\d{2})?)?$/.exec(s); }
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (!validYMD(y, mo, d)) return null;
    return { date: y + '-' + pad(mo) + '-' + pad(d), time: m[4] ? pad(+m[4]) + ':' + m[5] + ':' + (m[6] || '00') : '' };
  }
  function dayNum(ds) { var p = ds.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDayNum(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(ds, k) { return fromDayNum(dayNum(ds) + k); }
  function diffDays(a, b) { return dayNum(a) - dayNum(b); }
  function addMonthsAnchor(ds, k, anchor) {
    var p = ds.split('-').map(Number), t = p[0] * 12 + (p[1] - 1) + k, y = Math.floor(t / 12), m = t % 12 + 1;
    return y + '-' + pad(m) + '-' + pad(Math.min(anchor || p[2], daysIn(y, m)));
  }
  function fmt(c, sign) {
    var neg = c < 0; if (neg) c = -c;
    var w = Math.floor(c / 100), f = c % 100;
    return (neg ? '-' : (sign ? '+' : '')) + '¥' + String(w).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + pad(f);
  }

  function normKey(m) {
    return String(m || '').toLowerCase()
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/有限责任公司|股份有限公司|有限公司|科技|（中国）|网络技术|旗舰店|官方店|官方/g, '')
      .replace(/[\d\s\-_*·.,，。/:：、|]+/g, '');
  }

  /* ---------- 格式识别 ---------- */
  function idx(header, names) {
    for (var i = 0; i < names.length; i++) { var k = header.indexOf(names[i]); if (k >= 0) return k; }
    return -1;
  }
  function has(h, a) { return a.every(function (x) { return h.indexOf(x) >= 0; }); }

  function detect(rows) {
    var lim = Math.min(rows.length, 80);
    for (var i = 0; i < lim; i++) {
      var h = rows[i].map(function (x) { return x.replace(/\s/g, ''); });
      if (has(h, ['交易时间', '交易对方', '收/支']) && (h.indexOf('金额') >= 0) && h.indexOf('交易分类') >= 0) return { fmt: 'alipay', hi: i, label: '支付宝账单（新版“电子客户回单”）' };
      if (has(h, ['交易号', '交易对方', '收/支']) && idx(h, ['金额（元）', '金额(元)']) >= 0) return { fmt: 'alipay-old', hi: i, label: '支付宝交易记录明细（旧版）' };
      if (has(h, ['交易时间', '交易类型', '交易对方', '收/支']) && idx(h, ['金额(元)', '金额（元）']) >= 0) return { fmt: 'wechat', hi: i, label: '微信支付账单明细' };
      if (has(h, ['记账日期', '交易金额', '联机余额', '交易摘要'])) return { fmt: 'cmb', hi: i, label: '招商银行交易流水' };
      if (h.indexOf('交易日期') >= 0 && h.indexOf('摘要') >= 0 && idx(h, ['记账金额(支出)', '交易金额(支出)']) >= 0) return { fmt: 'icbc', hi: i, label: '工商银行明细' };
    }
    return null;
  }

  function guessMapping(rows) {
    // 取前 40 行中“非空列数最多且后面有数据”的行作表头
    var best = -1, bn = 0;
    for (var i = 0; i < Math.min(rows.length - 1, 40); i++) {
      var n = rows[i].filter(function (x) { return x !== ''; }).length;
      if (n >= 3 && n > bn) { bn = n; best = i; }
    }
    if (best < 0) best = 0;
    var h = (rows[best] || []).map(function (x) { return x.replace(/\s/g, ''); });
    function find(re) { for (var k = 0; k < h.length; k++) if (re.test(h[k])) return k; return -1; }
    var m = {
      hi: best,
      date: find(/日期|时间|date|time|^日子/i),
      merchant: find(/对方|商户|对手|交易对象|payee|merchant|店|名称|name/i),
      desc: find(/说明|商品|摘要|备注|用途|description|memo|note/i),
      amount: find(/^金额|金额\(|金额（|amount|发生额|交易金额/i),
      dir: find(/收\/支|收支|方向|^类型$|type/i),
      inCol: find(/收入|存入|贷方|credit/i), outCol: find(/支出|取出|借方|debit/i),
      sign: 'dir'
    };
    if (m.amount < 0 && (m.inCol >= 0 || m.outCol >= 0)) m.sign = 'split';
    else if (m.dir < 0) m.sign = 'neg-out';
    var ok = m.date >= 0 && (m.amount >= 0 || m.inCol >= 0 || m.outCol >= 0) && (m.merchant >= 0 || m.desc >= 0);
    return { mapping: m, ok: ok };
  }

  /* ---------- 记录规范化：返回 {recs:[], skipped:{原因:数量}, bad:n, declared:{...}} ---------- */
  var OPAQUE_RE = /待清算|网联.*(资金|核算)|银联.*(待清算|汇差)|核算专户/;
  var FAIL_RE = /关闭|失败|已取消|撤销|未支付|已拒绝/;

  function mk(o) { return o; }

  function normalize(rows, det, mapping) {
    var f = det.fmt, hi = det.hi, head = rows[hi].map(function (x) { return x.replace(/\s/g, ''); });
    var recs = [], skipped = {}, bad = 0, declared = null;
    function skip(r) { skipped[r] = (skipped[r] || 0) + 1; }
    function col(names) { return idx(head, names); }
    var C;
    if (f === 'alipay') C = { t: col(['交易时间']), cat: col(['交易分类']), cp: col(['交易对方']), desc: col(['商品说明']), dir: col(['收/支']), amt: col(['金额']), st: col(['交易状态']), ref: col(['交易订单号']), pay: col(['收/付款方式']) };
    if (f === 'alipay-old') C = { t: col(['付款时间', '交易创建时间']), t2: col(['最近修改时间']), cp: col(['交易对方']), desc: col(['商品名称']), dir: col(['收/支']), amt: col(['金额（元）', '金额(元)']), st: col(['交易状态']), ref: col(['交易号']), rf: col(['成功退款（元）', '成功退款(元)']), cat: col(['类型']) };
    if (f === 'wechat') C = { t: col(['交易时间']), cat: col(['交易类型']), cp: col(['交易对方']), desc: col(['商品']), dir: col(['收/支']), amt: col(['金额(元)', '金额（元）']), st: col(['当前状态']), ref: col(['交易单号']), pay: col(['支付方式']) };
    if (f === 'cmb') C = { t: col(['记账日期']), cur: col(['货币']), amt: col(['交易金额']), cat: col(['交易摘要']), cp: col(['对手信息']) };
    if (f === 'icbc') C = { t: col(['交易日期']), cat: col(['摘要']), place: col(['交易场所']), cp: col(['对方户名']), inn: col(['记账金额(收入)', '交易金额(收入)']), out: col(['记账金额(支出)', '交易金额(支出)']), cur: col(['记账币种', '交易币种']) };
    if (f === 'generic') {
      var m = mapping;
      C = m;
    }
    // 文件头里声明的汇总（仅供核对）
    if (f === 'alipay' || f === 'wechat') {
      declared = {};
      for (var i = 0; i < hi; i++) {
        var line = rows[i].join(' ');
        var mm = /^\s*(收入|支出|不计收支|中性交易)[：:]\s*(\d+)\s*笔\s*([\d,.]+)\s*元/.exec(line);
        if (mm) declared[mm[1]] = { n: +mm[2], c: toCents(mm[3]) };
      }
    }
    for (var r = hi + 1; r < rows.length; r++) {
      var x = rows[r];
      if (!x || x.every(function (v) { return v === ''; })) continue;
      var g = function (k) { return k >= 0 && k < x.length ? x[k] : ''; };
      var pd, rec;
      if (f === 'alipay' || f === 'alipay-old' || f === 'wechat') {
        pd = parseDate(g(C.t));
        if (!pd) { bad++; continue; }
        var dirT = g(C.dir), st = g(C.st), amtR = toCents(g(C.amt));
        if (amtR == null) { bad++; continue; }
        amtR = Math.abs(amtR);
        rec = { date: pd.date, time: pd.time, m: g(C.cp), d: g(C.desc), c: amtR, sc: g(C.cat), ref: g(C.ref).replace(/[\s\t]/g, ''), st: st, src: f === 'wechat' ? 'wechat' : 'alipay' };
        if (dirT === '支出') rec.k = 'out';
        else if (dirT === '收入') rec.k = 'in';
        else { skip(f === 'wechat' ? '中性交易（充值/提现/还款等，“/”）' : '不计收支'); continue; }
        if (FAIL_RE.test(st) && !/退款成功/.test(st)) { skip('状态为“' + st + '”（资金未实际支出）'); continue; }
        if (rec.k === 'in') rec.r = /退款/.test(st + rec.d + rec.sc + rec.m);
        else if (/退款/.test(st)) rec.rv = '状态含“退款”：' + st + '。若账单里没有对应的退款收入行，本条会被多算，请核对。';
        recs.push(rec);
        if (f === 'alipay-old' && C.rf >= 0) {
          var rf = toCents(g(C.rf));
          if (rf > 0 && rec.k === 'out') {
            var pd2 = parseDate(g(C.t2)) || pd;
            recs.push({ date: pd2.date, time: pd2.time, m: rec.m, d: '成功退款（来自“成功退款”列）', c: rf, sc: rec.sc, ref: rec.ref ? rec.ref + '-RF' : '', st: st, src: 'alipay', k: 'in', r: true, rv: '退款日期取“最近修改时间”，可能不是实际到账日。' });
          }
        }
      } else if (f === 'cmb') {
        pd = parseDate(g(C.t));
        if (!pd) { bad++; continue; }
        if (C.cur >= 0 && g(C.cur) && !/人民币|CNY|RMB/i.test(g(C.cur))) { skip('非人民币（' + g(C.cur) + '）未换算'); continue; }
        var a = toCents(g(C.amt));
        if (a == null || a === 0) { bad++; continue; }
        var cp = g(C.cp), summ = g(C.cat);
        rec = { date: pd.date, time: '', m: cp, d: summ, c: Math.abs(a), sc: summ, ref: '', st: '', src: 'cmb', k: a < 0 ? 'out' : 'in' };
        if (OPAQUE_RE.test(cp)) { rec.m = '（银行快捷支付·商户未知）'; rec.op = 1; }
        if (rec.k === 'in') rec.r = /退款|冲正/.test(summ);
        recs.push(rec);
      } else if (f === 'icbc') {
        pd = parseDate(g(C.t));
        if (!pd) { bad++; continue; }
        if (C.cur >= 0 && g(C.cur) && !/人民币|CNY|RMB|^-$/i.test(g(C.cur))) { skip('非人民币（' + g(C.cur) + '）未换算'); continue; }
        var ai = toCents(g(C.inn)), ao = toCents(g(C.out));
        if (!ai && !ao) { bad++; continue; }
        var summ2 = g(C.cat), place = g(C.place).replace(/^-$/, ''), cpn = g(C.cp);
        rec = { date: pd.date, time: '', m: place || cpn, d: summ2 + (cpn && place ? ' · ' + cpn : ''), c: Math.abs(ao || ai), sc: summ2, ref: '', st: '', src: 'icbc', k: ao ? 'out' : 'in' };
        if (rec.k === 'in') rec.r = /退款/.test(summ2);
        recs.push(rec);
      } else { // generic
        pd = parseDate(g(C.date));
        if (!pd) { bad++; continue; }
        var k, cents;
        if (C.sign === 'split') {
          var gi = toCents(g(C.inCol)), go = toCents(g(C.outCol));
          if (go) { k = 'out'; cents = Math.abs(go); } else if (gi) { k = 'in'; cents = Math.abs(gi); } else { bad++; continue; }
        } else {
          var av = toCents(g(C.amount));
          if (av == null || av === 0) { bad++; continue; }
          if (C.sign === 'neg-out') { k = av < 0 ? 'out' : 'in'; cents = Math.abs(av); }
          else if (C.sign === 'pos-out') { k = av > 0 ? 'out' : 'in'; cents = Math.abs(av); }
          else {
            var dv = g(C.dir);
            if (/支|出|付|消费|expense|debit|out/i.test(dv)) k = 'out';
            else if (/收|入|income|credit|in|退/i.test(dv)) k = 'in';
            else { skip('收支方向无法判断（“' + dv + '”）'); continue; }
            cents = Math.abs(av);
          }
        }
        var mer = g(C.merchant) || g(C.desc);
        rec = { date: pd.date, time: pd.time, m: mer, d: g(C.desc) === mer ? '' : g(C.desc), c: cents, sc: '', ref: '', st: '', src: 'csv', k: k, r: k === 'in' && /退款|refund/i.test(mer + g(C.desc) + g(C.dir)) };
        recs.push(rec);
      }
    }
    return { recs: recs, skipped: skipped, bad: bad, declared: declared };
  }

  /* ---------- 分类 ---------- */
  var SRC_CAT = { '餐饮美食': '餐饮', '交通出行': '交通', '日用百货': '购物', '服饰装扮': '购物', '数码电器': '购物', '充值缴费': '水电通讯', '住房物业': '居住', '文化休闲': '娱乐', '运动户外': '运动健身', '医疗健康': '医疗', '转账红包': '人情转账', '亲友代付': '人情转账', '教育培训': '学习', '爱车养车': '交通', '美容美发': '个人护理', '母婴亲子': '育儿', '商业服务': '其他', '酒店旅游': '旅行', '家居家装': '居住', '公共服务': '水电通讯', '投资理财': '投资理财', '保险': '保险', '商户消费': '购物', '扫二维码付款': '购物', '转账': '人情转账', '微信红包': '人情转账' };
  var DEFAULT_RULES = [
    { cat: '运动健身', kw: ['健身', '游泳', '瑜伽'] },
    { cat: '订阅会员', kw: ['netflix', '奈飞', 'icloud', 'spotify', '爱奇艺', '腾讯视频', '优酷', '哔哩哔哩', '会员', 'vip', '云盘', '订阅', '年卡', '周卡', '月卡', 'chatgpt', 'youtube'] },
    { cat: '居住', kw: ['房租', '房东', '物业'] },
    { cat: '水电通讯', kw: ['电力', '国网', '燃气', '水务', '话费', '中国移动', '中国联通', '中国电信'] },
    { cat: '餐饮', kw: ['美团', '饿了么', '餐', '面馆', '咖啡', '瑞幸', '星巴克', '奶茶', '麦当劳', '肯德基'] },
    { cat: '交通', kw: ['地铁', '公交', '滴滴', '打车', '高铁', '铁路', '加油', '12306'] },
    { cat: '购物', kw: ['淘宝', '京东', '拼多多', '天猫', '小米', '超市', '便利'] },
    { cat: '医疗', kw: ['医院', '药房', '药店', '诊所'] },
    { cat: '人情转账', kw: ['红包', '转账'] }
  ];
  function categorize(tx, rules) {
    var text = (tx.m + ' ' + tx.d + ' ' + (tx.sc || '')).toLowerCase();
    for (var i = 0; i < rules.length; i++) {
      var kws = rules[i].kw;
      for (var j = 0; j < kws.length; j++) { var k = String(kws[j]).trim().toLowerCase(); if (k && text.indexOf(k) >= 0) return rules[i].cat; }
    }
    if (tx.sc && SRC_CAT[tx.sc]) return SRC_CAT[tx.sc];
    return '未分类';
  }

  /* ---------- 入库去重键 ---------- */
  function baseKey(r) {
    return r.ref ? r.src + '#' + r.ref + '#' + r.k : [r.src, r.date, r.time, r.c, r.k, r.m, r.d].join('|');
  }

  /* ---------- 月度汇总 ---------- */
  // 口径：支出(out) − 退款(in 且 r=true)，退款计入“收到退款的当月”；被忽略(ig)的不算；普通收入单独列出。
  function monthStats(txs, month) {
    var s = { out: 0, refund: 0, income: 0, net: 0, byCat: {}, byMerchant: {}, n: 0 };
    txs.forEach(function (t) {
      if (t.ig || t.date.slice(0, 7) !== month) return;
      if (t.k === 'out') { s.out += t.c; s.byCat[t.cat] = (s.byCat[t.cat] || 0) + t.c; s.byMerchant[t.m] = (s.byMerchant[t.m] || 0) + t.c; s.n++; }
      else if (t.r) { s.refund += t.c; s.byCat[t.cat] = (s.byCat[t.cat] || 0) - t.c; s.byMerchant[t.m] = (s.byMerchant[t.m] || 0) - t.c; }
      else s.income += t.c;
    });
    s.net = s.out - s.refund;
    return s;
  }
  function monthsOf(txs) {
    var set = {}; txs.forEach(function (t) { set[t.date.slice(0, 7)] = 1; });
    return Object.keys(set).sort();
  }

  /* ---------- 周期性扣费识别（规则公开） ----------
     1) 只看“支出”，排除已忽略、银行快捷支付里商户未知的、已被同额退款抵消的；
     2) 按商户名归一（去数字/空格/标点/公司后缀）分组；
     3) 同商户内按“金额相近”聚类：以最近一笔为基准，|金额差| ≤ max(10%, ¥1)；
     4) 同一天多笔只算一次（防止同日多笔干扰间隔），但会在说明里提示；
     5) 从最近一笔往前找连续“每周(±1天)/每月(±5天，按日历月)/每年(±7天)”的最长链，允许整条链中缺 1 期；
        链长 ≥ 3（周、月）或 ≥ 2（年，置信度低）才算候选，金额不完全相同时月/周至少 4 期；链长还须 ≥ 该聚类笔数的 40%。 */
  var PERIODS = {
    week: { min: 3, label: '每周', per: 52 },
    month: { min: 3, label: '每月', per: 12 },
    year: { min: 2, label: '每年', per: 1 }
  };
  // 相邻两笔是否相隔 1 个（返回1）或 2 个周期（返回2，视为中间缺 1 期）；容差：周±1天，月±5天（按日历月推算，月末自动对齐），年±7天
  function fitK(p, prev, cur) {
    var maxK = p === 'year' ? 1 : 2;
    for (var k = 1; k <= maxK; k++) {
      var exp = p === 'week' ? addDays(prev, 7 * k) : p === 'month' ? addMonthsAnchor(prev, k, +prev.slice(8)) : addMonthsAnchor(prev, 12, +prev.slice(8));
      var tol = p === 'week' ? 1 : p === 'month' ? 5 : 7;
      if (Math.abs(diffDays(cur, exp)) <= tol) return k;
    }
    return 0;
  }
  function detectRecurring(txs, opt) {
    opt = opt || {};
    var tol = opt.tol == null ? 0.10 : opt.tol, tolAbs = 100;
    var elig = txs.filter(function (t) { return t.k === 'out' && !t.ig && !t.op && normKey(t.m); });
    // 退款配对：同商户、金额完全相同、退款日前 45 天内最近的一笔未配对支出
    var refunds = txs.filter(function (t) { return t.k === 'in' && t.r && !t.ig; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var removed = {}, refundedNote = {};
    refunds.forEach(function (rf) {
      var key = normKey(rf.m), best = null;
      elig.forEach(function (o) {
        if (removed[o.id] || normKey(o.m) !== key || o.c !== rf.c) return;
        var dd = diffDays(rf.date, o.date);
        if (dd >= 0 && dd <= 45 && (!best || o.date > best.date)) best = o;
      });
      if (best) { removed[best.id] = 1; refundedNote[best.id] = rf.date; }
    });
    var groups = {};
    elig.forEach(function (t) { if (!removed[t.id]) (groups[normKey(t.m)] = groups[normKey(t.m)] || []).push(t); });
    var out = [];
    Object.keys(groups).forEach(function (gk) {
      var items = groups[gk].slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time < b.time ? -1 : 1); });
      var rest = items.slice(), cl = 0, perKey = {};
      while (rest.length) {
        var anchor = rest[rest.length - 1].c, lim = Math.max(Math.round(anchor * tol), tolAbs);
        var cluster = rest.filter(function (t) { return Math.abs(t.c - anchor) <= lim; });
        rest = rest.filter(function (t) { return Math.abs(t.c - anchor) > lim; });
        // 同日合并
        var byDay = {}, days = [], sameDay = 0;
        cluster.forEach(function (t) { if (byDay[t.date]) { sameDay++; byDay[t.date].push(t); } else { byDay[t.date] = [t]; days.push(t.date); } });
        days.sort();
        var best = null;
        Object.keys(PERIODS).forEach(function (p) {
          var P = PERIODS[p], run = [days[days.length - 1]], skips = 0;
          for (var i = days.length - 2; i >= 0; i--) {
            var k = fitK(p, days[i], run[0]);
            if (k === 1 || (k === 2 && skips < 1)) { if (k === 2) skips++; run.unshift(days[i]); } else break;
          }
          var vary = false; // 金额不完全相同时，要求至少连续 4 期，降低巧合误报
          run.forEach(function (d) { byDay[d].forEach(function (t) { if (t.c !== byDay[days[days.length - 1]][0].c) vary = true; }); });
          var need = Math.max(P.min, vary && p !== 'year' ? 4 : 0);
          if (run.length >= need && run.length >= Math.ceil(0.4 * days.length) && (!best || run.length > best.run.length)) best = { p: p, run: run, skips: skips };
        });
        if (!best) continue;
        var P = PERIODS[best.p], runSet = {}; best.run.forEach(function (d) { runSet[d] = 1; });
        var members = []; best.run.forEach(function (d) { members = members.concat(byDay[d]); });
        var lastDay = best.run[best.run.length - 1], latest = byDay[lastDay][byDay[lastDay].length - 1];
        var amounts = members.map(function (t) { return t.c; });
        var mn = Math.min.apply(null, amounts), mx = Math.max.apply(null, amounts);
        var anchorDay = Math.max.apply(null, best.run.map(function (d) { return +d.slice(8); }));
        var lastDom = +lastDay.slice(8), useDom = (lastDom === daysIn(+lastDay.slice(0, 4), +lastDay.slice(5, 7)) && anchorDay > lastDom) ? anchorDay : lastDom;
        var next = best.p === 'week' ? addDays(lastDay, 7) : best.p === 'month' ? addMonthsAnchor(lastDay, 1, useDom) : addMonthsAnchor(lastDay, 12, lastDom);
        var notes = [];
        if (mn !== mx) notes.push('金额有波动（' + fmt(mn) + ' ~ ' + fmt(mx) + '），下次金额与年化按最近一笔估算');
        var sdSame = members.length - best.run.length;
        if (best.skips) notes.push('链中有 1 期缺失（可能被退款、扣款失败或账单未覆盖）');
        if (sameDay && cluster.length > best.run.length) notes.push('同商户另有同日多笔/非规律笔数已排除在周期之外');
        if (best.run.length < days.length) notes.push('该商户同金额区间内另有 ' + (days.length - best.run.length) + ' 个日期不在规律链上');
        var skey = gk + '|' + best.p; if (perKey[skey]) { perKey[skey]++; skey += '#' + perKey[skey]; } else perKey[skey] = 1;
        out.push({
          key: skey, mk: gk, merchant: latest.m, period: best.p, plabel: P.label, amount: latest.c, count: best.run.length,
          dates: best.run, tx: members.map(function (t) { return t.id; }), last: lastDay, next: next,
          conf: best.p === 'year' ? 'low' : (best.run.length >= 4 ? 'high' : 'mid'), variable: mn !== mx, min: mn, max: mx, notes: notes,
          cat: latest.cat, anchorDay: anchorDay
        });
      }
    });
    out.sort(function (a, b) { return b.amount * PERIODS[b.period].per - a.amount * PERIODS[a.period].per; });
    return out;
  }

  // 距离预计扣费日的状态
  var GRACE = { week: 3, month: 7, year: 15 };
  function dueStatus(next, period, today, remind) {
    var d = diffDays(next, today);
    if (d >= 0 && d <= remind) return { s: d === 0 ? 'today' : 'soon', d: d };
    if (d < 0 && -d <= GRACE[period]) return { s: 'late', d: -d };
    if (d < 0) return { s: 'stopped', d: -d };
    return { s: 'ok', d: d };
  }
  function annual(amount, period) { return amount * PERIODS[period].per; }

  function budgetStatus(spent, budget) {
    if (!budget) return null;
    var p = budget > 0 ? spent / budget : 0;
    return { pct: p, level: spent > budget ? 'over' : p >= 0.8 ? 'warn' : 'ok', left: budget - spent };
  }

  return { parseCSV: parseCSV, toCents: toCents, parseDate: parseDate, fmt: fmt, normKey: normKey, detect: detect, guessMapping: guessMapping, normalize: normalize, categorize: categorize, DEFAULT_RULES: DEFAULT_RULES, SRC_CAT: SRC_CAT, baseKey: baseKey, monthStats: monthStats, monthsOf: monthsOf, detectRecurring: detectRecurring, PERIODS: PERIODS, dueStatus: dueStatus, annual: annual, budgetStatus: budgetStatus, addDays: addDays, diffDays: diffDays, daysIn: daysIn, addMonthsAnchor: addMonthsAnchor };
});
