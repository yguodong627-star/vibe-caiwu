// 无头 Chrome 端到端自测（playwright-core + 系统 Chrome）：导入三种账单 → 对账 → 订阅确认 → 预算 → 备份/恢复 → 刷新持久化 → 桌面/手机截图
const { chromium } = require('/workspace/tools/node_modules/playwright-core');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'), DATA=path.join(__dirname,'data'), SH=path.join(ROOT,'screenshots');
const E=JSON.parse(fs.readFileSync(DATA+'/expected.json','utf8'));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
const srv=http.createServer((q,r)=>{let p=q.url.split('?')[0];if(p==='/')p='/index.html';const f=path.join(ROOT,p);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;return r.end()}r.setHeader('content-type',mime[path.extname(f)]||'text/plain');r.end(fs.readFileSync(f))}).listen(8140);
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const money=c=>'¥'+(Math.floor(c/100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+String(c%100).padStart(2,'0');
(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
 await ctx.addInitScript(()=>{document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.toast{display:none!important}';document.head.appendChild(s)})}); const page=await ctx.newPage(); page.on('dialog',d=>d.accept());
 const errs=[],ext=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 page.on('request',r=>{const u=r.url(); if(!u.startsWith('http://localhost:8140')&&!u.startsWith('data:')&&!u.startsWith('blob:'))ext.push(u)});
 const U='http://localhost:8140/?today=2026-10-18';
 await page.goto(U); await page.waitForSelector('#hero h1');
 await page.screenshot({path:SH+'/desktop-0-empty.png'});
 // 导入三个文件
 await page.click('[data-act=nav][data-v=data]');
 await page.setInputFiles('#fileIn',[DATA+'/alipay.csv',DATA+'/wechat.csv',DATA+'/cmb.csv']);
 await page.waitForSelector('.pv >> nth=2');
 const pvText=await page.$$eval('.pv',els=>els.map(e=>e.innerText));
 ok(/支付宝账单/.test(pvText[0])&&/GBK/.test(pvText[0]),'预览1：识别支付宝+GBK');
 ok(/一致 ✓/.test(pvText[0]),'预览1：与文件头统计一致');
 ok(/微信支付账单明细/.test(pvText[1])&&/一致 ✓/.test(pvText[1]),'预览2：微信 + 与文件头一致');
 ok(/招商银行/.test(pvText[2]),'预览3：招行');
 ok(/不计收支 1 条/.test(pvText[0])&&/交易关闭/.test(pvText[0]),'预览1：不计收支/交易关闭已排除并说明');
 await page.screenshot({path:SH+'/desktop-1-import-preview.png',fullPage:false});
 for(let i=0;i<3;i++) await page.click('[data-act=pvok] >> nth=0');
 await page.waitForFunction(()=>window.__xishui.S().txs.length>=290);
 const S=await page.evaluate(()=>window.__xishui.S());
 ok(S.txs.length===E.counts.ali_out+E.counts.ali_in+E.counts.wx_out+E.counts.cmb_rows,'入库笔数 '+S.txs.length);
 // 总览：逐月核对页面显示的数字
 await page.click('[data-act=nav][data-v=overview]');
 let allGood=true;
 for(const m of ['2025-10','2026-03','2026-08','2026-09','2026-10']){
   await page.selectOption('[data-act=mset]',m); const t=await page.innerText('#hero h1'); const exp=money(E.monthly_net_cents[m]);
   if(t.trim()!==exp){allGood=false;console.log('  月',m,'页面',t,'期望',exp);}
 }
 ok(allGood,'总览英雄区数字与期望逐月一致（含跨月/退款月）');
 await page.selectOption('[data-act=mset]','2026-09');
 await page.screenshot({path:SH+'/desktop-2-overview.png',fullPage:true});
 // 范围切换：只看支付宝
 await page.selectOption('#scopeSel','alipay'); await page.selectOption('[data-act=mset]','2026-09');
 ok((await page.innerText('#hero h1')).trim()===money(E.sources_month_cents.ali['2026-09']),'范围=支付宝：2026-09 = '+money(E.sources_month_cents.ali['2026-09']));
 await page.selectOption('#scopeSel','all');
 // 订阅
 await page.click('[data-act=nav][data-v=subs]');
 const pend=await page.$$eval('.cand',e=>e.length); ok(pend===E.subs.length,'订阅页待确认 '+pend+' 条 = 期望 '+E.subs.length);
 await page.screenshot({path:SH+'/desktop-3-subs-pending.png',fullPage:true});
 // 排除房东张三（房租）测试；其余确认
 const names=await page.$$eval('.cand h4',e=>e.map(x=>x.innerText));
 for(const n of names){
   const idx=(await page.$$eval('.cand h4',e=>e.map(x=>x.innerText))).findIndex(x=>x===n);
   if(n.startsWith('房东张三')) await page.click(`.cand >> nth=${idx} >> [data-act=sexc]`); else await page.click(`.cand >> nth=${idx} >> [data-act=sconf]`);
 }
 const exp=E.subs.filter(s=>s.merchant!=='房东张三'&&!s.stopped).reduce((s,x)=>s+x.annual,0);
 const hero=(await page.innerText('#hero h1')).trim();
 ok(hero===money(exp),'年化订阅成本 '+hero+' = 期望 '+money(exp)+'（已确认8项，排除房租，排除疑似已停止的迷你健身App）');
 const rem=await page.innerText('#hero'); ok(/疑似已停止/.test(rem),'英雄区提示疑似已停止项未计入');
 await page.screenshot({path:SH+'/desktop-4-subs-confirmed.png',fullPage:true});
 // 总览提醒
 await page.click('[data-act=nav][data-v=overview]');
 const alerts=await page.innerText('#content');
 ok(/Spotify 将在 2 天后/.test(alerts),'提醒：Spotify 2 天后'); ok(/迅捷云盘周卡 预计今天扣费/.test(alerts),'提醒：周卡今天扣费');
 ok(!/力迈健身 将在/.test(alerts),'提醒：力迈健身 13 天后在 7 天窗口外，不提醒');
 // 预算
 await page.click('[data-act=nav][data-v=budget]'); await page.selectOption('[data-act=mset]','2026-09');
 await page.fill('#bTotal','1000'); await page.dispatchEvent('#bTotal','change');
 await page.fill('[data-cb="购物"]','200'); await page.dispatchEvent('[data-cb="购物"]','change');
 let bt=await page.innerText('#content'); ok(/超出|已超/.test(bt),'预算页：9 月超预算标识');
 await page.screenshot({path:SH+'/desktop-5-budget.png',fullPage:true});
 await page.click('[data-act=nav][data-v=overview]');
 ok(/总支出已超预算/.test(await page.innerText('#content')),'总览出现“总支出已超预算”提醒');
 // 流水：改分类，忽略
 await page.click('[data-act=nav][data-v=tx]'); await page.fill('#fq','小米商城'); await page.waitForTimeout(500);
 const nrows=await page.$$eval('.tbl tbody tr',e=>e.length); ok(nrows===2,'搜索“小米商城”得 2 条（支出+部分退款）');
 await page.screenshot({path:SH+'/desktop-6-tx.png'});
 await page.fill('#fq','');await page.waitForTimeout(500);
 // 规则：新增规则并重新分类
 await page.click('[data-act=nav][data-v=rules]'); await page.click('[data-act=radd]');
 await page.fill('#ruleList .rule-row:last-child [data-rc]','小米生态'); await page.fill('#ruleList .rule-row:last-child [data-rk]','小米');
 for(let i=0;i<S.rules.length;i++){}
 // 移到最上
 for(let i=0;i<10;i++){ const n=await page.$$eval('#ruleList .rule-row',e=>e.length); await page.click(`[data-act=rup][data-i="${n-1-i}"]`).catch(()=>{}); }
 await page.click('[data-act=rapply]'); 
 const cat=await page.evaluate(()=>window.__xishui.S().txs.find(t=>t.m==='小米商城').cat); ok(cat==='小米生态','自定义规则生效：小米商城→小米生态（置顶规则优先）');
 await page.screenshot({path:SH+'/desktop-7-rules.png'});
 // 通用 CSV 手动映射
 await page.click('[data-act=nav][data-v=data]');
 await page.setInputFiles('#fileIn',DATA+'/generic.csv'); await page.waitForSelector('.pv');
 ok(/手动映射列/.test(await page.innerText('.pv'))&&/没能自动识别/.test(await page.innerText('.pv')),'通用CSV：提示手动映射');
 await page.selectOption('.pv [data-m=date]','0'); await page.selectOption('.pv [data-m=merchant]','1'); await page.selectOption('.pv [data-m=amount]','2'); await page.selectOption('.pv [data-m=dir]','3');
 const pt=await page.innerText('.pv'); ok(/将导入 4 笔/.test(pt)&&/支出 3 笔 ¥48\.20/.test(pt)&&/收入 1 笔 ¥200\.00/.test(pt),'手动映射后预览：4 笔，支出3笔¥48.20，收入1笔¥200.00（同日同额两行都保留）');
 await page.screenshot({path:SH+'/desktop-8-mapping.png',fullPage:false});
 await page.click('[data-act=pvok]');
 // 重复导入同一文件
 await page.setInputFiles('#fileIn',DATA+'/alipay.csv'); await page.waitForSelector('.pv');
 ok(/将导入 0 笔/.test(await page.innerText('.pv'))&&/重复记录：227/.test(await page.innerText('.pv')),'重复导入支付宝：将导入 0 笔，跳过 227 笔重复'); await page.click('[data-act=pvno]');
 // 导出
 const dl1=page.waitForEvent('download'); await page.click('[data-act=exTx]'); const d1=await dl1; const p1=path.join('/tmp','tx.csv'); await d1.saveAs(p1);
 const csvTx=fs.readFileSync(p1,'utf8'); ok(csvTx.charCodeAt(0)===0xFEFF&&csvTx.trim().split('\r\n').length===S.txs.length+4+1,'导出流水 CSV：BOM + '+(S.txs.length+4)+' 行数据');
 const dl2=page.waitForEvent('download'); await page.click('[data-act=exSub]'); await (await dl2).saveAs('/tmp/subs.csv'); const cs=fs.readFileSync('/tmp/subs.csv','utf8'); ok(/奈飞 Netflix,已确认,每月,72\.00,864\.00/.test(cs),'导出订阅 CSV 含 奈飞 72.00 / 年化 864.00');
 const dl3=page.waitForEvent('download'); await page.click('[data-act=exJson]'); await (await dl3).saveAs('/tmp/backup.json');
 const before=await page.evaluate(()=>JSON.stringify(window.__xishui.S().txs.map(t=>[t.date,t.c,t.k,t.cat])));
 // 刷新持久化
 console.log('  before reload', await page.evaluate(()=>window.__xishui.S().txs.length)); await page.waitForTimeout(700); await page.reload(); await page.waitForSelector('#hero h1');
 const n2=await page.evaluate(()=>window.__xishui.S().txs.length); ok(n2===S.txs.length+4,'刷新后数据仍在（IndexedDB）：'+n2+' 笔');
 // 清空 → 恢复（覆盖）
 await page.click('[data-act=nav][data-v=data]'); await page.click('[data-act=clear]');
 ok((await page.evaluate(()=>window.__xishui.S().txs.length))===0,'清空后 0 笔');
 await page.setInputFiles('#restoreIn','/tmp/backup.json'); await page.waitForFunction(()=>window.__xishui.S().txs.length>0);
 const after=await page.evaluate(()=>JSON.stringify(window.__xishui.S().txs.map(t=>[t.date,t.c,t.k,t.cat])));
 ok(before===after,'备份→清空→覆盖恢复：全部流水（日期/金额/方向/分类）逐条一致');
 ok((await page.evaluate(()=>Object.keys(window.__xishui.S().subs).length))>=8,'订阅确认结果随备份恢复');
 await page.screenshot({path:SH+'/desktop-9-data.png',fullPage:true});
 ok(ext.length===0,'页面零外部网络请求：'+JSON.stringify(ext));
 ok(errs.length===0,'无 JS 报错：'+JSON.stringify(errs));
 await ctx.close();
 // ---- 手机 ----
 const mctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,acceptDownloads:true});
 await mctx.addInitScript(()=>{document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.toast{display:none!important}';document.head.appendChild(s)})}); const mp=await mctx.newPage(); mp.on('dialog',d=>d.accept()); const merr=[]; mp.on('pageerror',e=>merr.push(String(e)));
 await mp.goto(U); await mp.waitForSelector('#hero h1'); await mp.screenshot({path:SH+'/mobile-0-empty.png'});
 await mp.click('[data-act=nav][data-v=data]'); await mp.setInputFiles('#fileIn',[DATA+'/alipay.csv',DATA+'/wechat.csv',DATA+'/cmb.csv']); await mp.waitForSelector('.pv >> nth=2');
 await mp.screenshot({path:SH+'/mobile-1-import.png'});
 for(let i=0;i<3;i++) await mp.click('[data-act=pvok] >> nth=0');
 await mp.waitForFunction(()=>window.__xishui.S().txs.length>=290);
 await mp.click('[data-act=nav][data-v=overview]'); await mp.selectOption('[data-act=mset]','2026-09'); await mp.screenshot({path:SH+'/mobile-2-overview.png'}); await mp.screenshot({path:SH+'/mobile-2b-overview-full.png',fullPage:true});
 await mp.click('[data-act=nav][data-v=subs]'); await mp.screenshot({path:SH+'/mobile-3-subs.png'});
 for(let i=0;i<9;i++) await mp.click('.cand >> nth=0 >> [data-act=sconf]');
 await mp.screenshot({path:SH+'/mobile-4-subs-confirmed.png'});
 await mp.click('[data-act=nav][data-v=tx]'); await mp.screenshot({path:SH+'/mobile-5-tx.png'});
 await mp.click('[data-act=nav][data-v=budget]'); await mp.screenshot({path:SH+'/mobile-6-budget.png'});
 const ow=await mp.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1); ok(!ow,'手机无横向溢出');
 ok(merr.length===0,'手机端无 JS 报错');
 await b.close(); srv.close();
 console.log(fails?('\n失败 '+fails+' 项'):'\n全部通过'); process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(2)});
