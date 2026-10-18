// Node 自测：用 gen_bills.py 生成的模拟账单，对照 expected.json（由构造事实独立算出）。
const fs=require('fs'),path=require('path'),Core=require('../core.js');
const D=path.join(__dirname,'data'); const E=JSON.parse(fs.readFileSync(D+'/expected.json','utf8'));
let fails=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
function dec(buf){ try{return new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch(e){return new TextDecoder('gbk').decode(buf);} }
function load(name){
  const text=dec(fs.readFileSync(D+'/'+name)); const rows=Core.parseCSV(text); const det=Core.detect(rows);
  return {rows,det};
}
let all=[],seen={},id=0;
function ingest(name,mapping){
  let {rows,det}=load(name); if(!det){ det={fmt:'generic',hi:mapping.hi}; }
  const r=Core.normalize(rows,det,mapping);
  const occ={}; let dup=0,added=0;
  r.recs.forEach(x=>{const b=Core.baseKey(x); occ[b]=(occ[b]||0)+1; const k=b+'@'+occ[b]; if(seen[k]){dup++;return;} seen[k]=1;
    x.id='t'+(id++); x.cat=Core.categorize(x,Core.DEFAULT_RULES); all.push(x); added++;});
  return {det,r,added,dup};
}
const a=ingest('alipay.csv'), w=ingest('wechat.csv'), c=ingest('cmb.csv');
ok(a.det.fmt==='alipay','识别支付宝（GBK 解码）'); ok(w.det.fmt==='wechat','识别微信（UTF-8 BOM）'); ok(c.det.fmt==='cmb','识别招行');
ok(a.r.recs.filter(x=>x.k==='out').length===E.counts.ali_out,'支付宝支出笔数 '+E.counts.ali_out);
ok(a.r.recs.filter(x=>x.k==='in').length===E.counts.ali_in,'支付宝退款笔数');
ok(w.r.recs.filter(x=>x.k==='out').length===E.counts.wx_out,'微信支出笔数');
ok(c.r.recs.length===E.counts.cmb_rows,'招行行数');
ok(a.r.skipped['不计收支']===1 && Object.keys(a.r.skipped).some(k=>/交易关闭|状态为/.test(k)),'支付宝：不计收支/交易关闭被排除 '+JSON.stringify(a.r.skipped));
ok(Object.values(w.r.skipped).reduce((x,y)=>x+y,0)===E.skipped.wx_neutral,'微信：中性交易 2 条被排除');
ok(a.r.bad===0&&w.r.bad===0&&c.r.bad===0,'无解析失败行');
// 文件头声明核对
const decl=a.r.declared['支出']; const myOut=a.r.recs.filter(x=>x.k==='out').reduce((s,x)=>s+x.c,0);
ok(decl.n===a.r.recs.filter(x=>x.k==='out').length && decl.c===myOut,'支付宝：与文件头“支出”笔数/金额一致 '+decl.n+'笔 '+Core.fmt(decl.c));
const wd=w.r.declared['支出']; ok(wd.n===w.r.recs.filter(x=>x.k==='out').length && wd.c===w.r.recs.filter(x=>x.k==='out').reduce((s,x)=>s+x.c,0),'微信：与文件头“支出”一致');
// 月度净支出
const months=Core.monthsOf(all); const nonInc=all.filter(x=>!(x.k==='in'&&!x.r));
let monthlyOK=true; const mm={};
months.forEach(m=>{const s=Core.monthStats(all,m); mm[m]=s.net; if((E.monthly_net_cents[m]||0)!==s.net){monthlyOK=false;console.log('  月份不符',m,s.net,E.monthly_net_cents[m]);}});
ok(monthlyOK && Object.keys(E.monthly_net_cents).every(m=>m in mm),'每月净支出全部与期望一致（'+months.length+' 个月）');
ok(Object.values(mm).reduce((s,x)=>s+x,0)===E.total_net_cents,'总净支出 '+Core.fmt(E.total_net_cents)+' 完全一致');
ok(Core.monthStats(all,'2026-09').refund===10000+2350,'2026-09 退款=小米部分100.00+快捷退款23.50');
ok(Core.monthStats(all,'2026-10').refund===12800,'2026-10 淘宝全额退款128.00 计入10月');
ok(Core.monthStats(all,'2026-08').out - 0 >0 ,'8月有数据');
// 跨月
const t831=all.find(x=>x.m==='便利蜂'&&x.date==='2026-08-31'), t901=all.find(x=>x.m==='便利蜂'&&x.date==='2026-09-01');
ok(t831&&t901&&t831.time==='23:59:58','跨月：8/31 23:59:58 归 8 月，9/1 00:00:02 归 9 月');
// 同日多笔
ok(all.filter(x=>x.m==='瑞幸咖啡'&&x.date==='2026-07-14').length===3,'同日 3 笔瑞幸全部保留');
// 来源拆分
for(const [src,key] of [['alipay','ali'],['wechat','wx'],['cmb','cmb']]){
  const sub=all.filter(x=>x.src===src); let good=true; Object.entries(E.sources_month_cents[key]).forEach(([m,v])=>{if(Core.monthStats(sub,m).net!==v)good=false;});
  ok(good,'分来源汇总一致：'+src);
}
// 周期识别
const subs=Core.detectRecurring(all,{}); const by={}; subs.forEach(s=>by[s.merchant]=s);
console.log('  识别出：',subs.map(s=>s.merchant+'/'+s.period+'/'+Core.fmt(s.amount)).join('；'));
E.subs.forEach(e=>{const s=by[e.merchant]; const g=s&&s.period===e.period&&s.amount===e.latest&&(!e.last||s.last===e.last)&&(!e.next||s.next===e.next)&&Core.annual(s.amount,s.period)===e.annual;
  ok(!!g,'识别 '+e.merchant+' '+e.period+' 最近'+Core.fmt(e.latest)+(e.last?' 最近扣款'+e.last+' 下次'+e.next:'')+' 年化'+Core.fmt(e.annual)+(s&&!g?'  实际:'+JSON.stringify([s.period,s.amount,s.last,s.next]):''));});
ok(subs.length===E.subs.length,'候选总数恰为 '+E.subs.length+'（无误报，实际 '+subs.length+'）');
E.not_subs.forEach(n=>ok(!subs.some(s=>s.merchant===n),'不应识别：'+n));
const today='2026-10-18';
const ds=(m)=>Core.dueStatus(by[m].next,by[m].period,today,7);
ok(ds('Spotify').s==='soon'&&ds('Spotify').d===2,'Spotify 2 天后到期提醒');
ok(ds('迅捷云盘周卡').s==='today','周卡今日扣费');
ok(Core.dueStatus(by['力迈健身'].next,'month',today,7).s==='ok'&&Core.dueStatus(by['力迈健身'].next,'month',today,14).s==='soon','健身 13 天后：7天窗口不提醒，14天窗口提醒');
ok(ds('迷你健身App').s==='stopped','迷你健身App 疑似已停止');
ok(by['奈飞 Netflix'].variable&&by['奈飞 Netflix'].min===6800,'Netflix 涨价 68→72 记为金额波动');
ok(by['爱奇艺黄金VIP年卡'].conf==='low','年卡仅 2 次：置信度低');
// 退款配对：Spotify 5 月被退款的那笔不应参与周期
ok(!by['Spotify'].dates.includes('2026-05-20'),'被同额退款抵消的 Spotify 5/20 不计入周期链');
// 重复导入
const again=ingest('alipay.csv'); ok(again.added===0&&again.dup===a.r.recs.length,'重复导入同一文件：新增 0，跳过 '+again.dup);
// 通用映射
const g=ingest('generic.csv',{hi:0,date:0,merchant:1,desc:-1,amount:2,dir:3,inCol:-1,outCol:-1,sign:'dir'});
const gs=g.r.recs; ok(gs.length===4&&gs.filter(x=>x.k==='out').reduce((s,x)=>s+x.c,0)===E.generic.out_cents&&gs.filter(x=>x.k==='in').reduce((s,x)=>s+x.c,0)===E.generic.in_cents,'通用手动映射：支出 '+Core.fmt(E.generic.out_cents)+' 收入 '+Core.fmt(E.generic.in_cents)+'，同日同额两行均保留');
ok(g.added===4,'通用：完全相同的两行记录都入库（按出现次序去重）');
const gm=Core.guessMapping(Core.parseCSV(fs.readFileSync(D+'/generic.csv','utf8'))); ok(!gm.ok,'列名无法自动识别时要求手动映射');
// 工具函数
ok(Core.toCents('1,234.5')===123450&&Core.toCents('¥-8.005')===-801&&Core.toCents('(3.20)')===-320&&Core.toCents('abc')===null,'金额解析（千分位/￥/括号负数/三位小数四舍五入）');
ok(Core.addMonthsAnchor('2026-02-28',1,31)==='2026-03-31'&&Core.addMonthsAnchor('2026-01-31',1,31)==='2026-02-28'&&Core.addMonthsAnchor('2026-12-15',1,15)==='2027-01-15','月末锚点推算');
console.log(fails?('\n失败 '+fails+' 项'):'\n全部通过'); process.exit(fails?1:0);
