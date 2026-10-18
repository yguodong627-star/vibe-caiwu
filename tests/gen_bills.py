#!/usr/bin/env python3
"""生成模拟账单（支付宝 GBK / 微信 UTF-8 BOM / 招行 / 通用）+ 独立的期望结果 expected.json。
期望值由“构造时记录的事实”用整数分累加得到，不经过被测代码。"""
import random, json, datetime as dt, csv, io, os
random.seed(20261018)
OUT = os.path.join(os.path.dirname(__file__), 'data'); os.makedirs(OUT, exist_ok=True)
D = dt.date
facts = []   # dict(date,time,merchant,cents,kind: out|in(refund)|inc, src)
rows_ali, rows_wx, rows_cmb = [], [], []
oid = [202610000000]
def nid():
    oid[0] += 7919; return str(oid[0]) + '0000000000000'
def fen(x): return int(round(x*100))
def money(c): return f"{c//100}.{c%100:02d}"
def add(src, date, time, merchant, cents, kind, cat='其他', desc='', status='交易成功', extra=None):
    facts.append(dict(date=date.isoformat(), time=time, merchant=merchant, cents=cents, kind=kind, src=src))
    if src == 'ali':
        rows_ali.append([f"{date.isoformat()} {time}", cat, merchant, 'x***@mail.com', desc or merchant, '支出' if kind=='out' else '收入', money(cents), '余额宝' if kind=='out' else '原路退回', status, nid()+'\t', 'M'+nid()+'\t', ''])
    elif src == 'wx':
        typ = extra or ('商户消费' if kind=='out' else '商户退款')
        rows_wx.append([f"{date.isoformat()} {time}", typ, merchant, desc or merchant, '支出' if kind=='out' else '收入', '¥'+money(cents), '零钱' if kind=='out' else '原路退回', '支付成功' if kind=='out' else '已退款', nid()+'\t', 'W'+nid()+'\t', '/'])
    elif src == 'cmb':
        pass
def months(start, end):
    y, m = start
    while (y, m) <= end:
        yield y, m
        m += 1
        if m == 13: y, m = y+1, 1
def mdays(y, m):
    return (D(y+(m==12), m%12+1, 1) - dt.timedelta(days=1)).day
TODAY = D(2026,10,18)
def mon(y,m,d,*a):
    return D(y, m, min(d, mdays(y,m)))
ALLM = list(months((2025,10),(2026,10)))

# ---- 订阅类（期望被识别）----
for y,m in ALLM:
    d = mon(y,m,5)
    if d <= TODAY: add('ali', d, '08:%02d:11'%random.randint(0,59), '奈飞 Netflix', fen(68 if (y,m)<(2026,7) else 72), 'out', '文化休闲', '会员月费')
    d = mon(y,m,random.choice([1,2,3]))
    if d <= TODAY: add('ali', d, '03:10:0%d'%random.randint(0,9), 'iCloud 50GB', fen(6), 'out', '充值缴费', 'iCloud+ 存储')
    d = mon(y,m,20)
    if d <= TODAY and (y,m) >= (2025,10):
        add('ali', d, '12:00:05', 'Spotify', fen(15), 'out', '文化休闲', 'Spotify Premium')
        if (y,m) == (2026,5):
            add('ali', D(2026,5,22), '10:30:00', 'Spotify', fen(15), 'in', '文化休闲', '退款-Spotify Premium', '退款成功')
    d = mon(y,m,31)
    if d <= TODAY: add('wx', d, '07:%02d:00'%random.randint(10,59), '力迈健身', fen(300), 'out', desc='月卡自动续费')
    d = mon(y,m,random.randint(8,12))
    if d <= TODAY: add('ali', d, '09:20:00', '国网电力', fen(85.0 if (y,m)==(2026,10) else random.choice([78.20,81.5,84.0,85.0,88.3,90.1,79.9,86.4,83.3,91.0,80.6,87.2])), 'out', '充值缴费', '电费缴纳')
    if (y,m) <= (2026,3) and (y,m) >= (2025,10):
        add('ali', mon(y,m,8), '20:00:00', '迷你健身App', fen(25), 'out', '文化休闲', '月卡')
# 周卡：8 个周日
d = D(2026,8,23)
while d < TODAY:
    add('ali', d, '10:00:00', '迅捷云盘周卡', fen(5), 'out', '充值缴费', '周卡续费'); d += dt.timedelta(days=7)
# 年卡：2 次
add('ali', D(2025,10,15), '09:00:00', '爱奇艺黄金VIP年卡', fen(198), 'out', '文化休闲', '年卡')
add('ali', D(2026,10,15), '09:00:00', '爱奇艺黄金VIP年卡', fen(198), 'out', '文化休闲', '年卡')

# ---- 非订阅（期望不被识别）----
for i in range(95):
    d = D(2025,10,1) + dt.timedelta(days=random.randint(0,382))
    if d > TODAY: continue
    add('ali', d, '%02d:%02d:00'%(random.randint(11,20),random.randint(0,59)), random.choice(['美团外卖','饿了么','老王面馆']), fen(round(random.uniform(12,68),2)), 'out', '餐饮美食')
for i in range(70):
    d = D(2025,10,1) + dt.timedelta(days=random.randint(0,382))
    if d > TODAY or d.weekday()>=5: continue
    add('ali', d, '08:%02d:00'%random.randint(0,59), '北京地铁', fen(3), 'out', '交通出行', '乘车')
for i in range(25):
    d = D(2025,10,1) + dt.timedelta(days=random.randint(0,382))
    if d > TODAY: continue
    add('wx', d, '%02d:%02d:00'%(random.randint(8,18),random.randint(0,59)), '瑞幸咖啡', fen(9.9), 'out')
# 同日多笔（金额相同、不同时间、不同单号）
for t in ['09:01:00','09:03:00','17:40:00']:
    add('ali', D(2026,7,14), t, '瑞幸咖啡', fen(9.9), 'out', '餐饮美食')
# 部分退款 / 跨月退款
add('ali', D(2026,9,10), '14:00:00', '小米商城', fen(300), 'out', '数码电器')
add('ali', D(2026,9,18), '11:00:00', '小米商城', fen(100), 'in', '数码电器', '退款-部分', '退款成功')
add('ali', D(2026,9,29), '21:00:00', '淘宝-某店铺', fen(128), 'out', '日用百货')
add('ali', D(2026,10,3), '09:30:00', '淘宝-某店铺', fen(128), 'in', '日用百货', '退款-全额', '退款成功')
# 跨月边界
add('wx', D(2026,8,31), '23:59:58', '便利蜂', fen(12.5), 'out')
add('wx', D(2026,9,1), '00:00:02', '便利蜂', fen(12.5), 'out')
# 两次相同金额转账（2 次、非周期）
add('wx', D(2026,3,3), '12:00:00', '老李', fen(500), 'out', extra='转账')
add('wx', D(2026,4,4), '12:00:00', '老李', fen(500), 'out', extra='转账')

# 支付宝特殊行（应被排除）
SKIP_ALI = [
 ['2026-09-15 10:00:00','投资理财','余额宝','x','余额宝-转入','不计收支','1000.00','银行卡','交易成功','S1\t','',''],
 ['2026-09-16 10:00:00','日用百货','淘宝-已关闭订单','x','未付款订单','支出','59.00','余额宝','交易关闭','S2\t','',''],
]
SKIP_WX = [
 ['2026-09-20 10:00:00','零钱充值','招商银行(0000)','/','/','¥500.00','招商银行','充值完成','S3\t','','/'],
 ['2026-09-21 10:00:00','信用卡还款','招商银行信用卡','/','/','¥1,200.00','零钱','支付成功','S4\t','','/'],
]

# ---- 招行（银行流水，带对手信息）----
cmb = []
for y,m in ALLM:
    d = mon(y,m,1)
    if d <= TODAY:
        cmb.append((d,'手机银行转账','房东张三',-fen(3500),'out'))
        facts.append(dict(date=d.isoformat(),time='',merchant='房东张三',cents=fen(3500),kind='out',src='cmb'))
    d = mon(y,m,15)
    if d <= TODAY:
        cmb.append((d,'代发工资','某某科技有限公司',fen(15000),'inc'))
        facts.append(dict(date=d.isoformat(),time='',merchant='某某科技有限公司',cents=fen(15000),kind='inc',src='cmb'))
OPAQUE = '待清算电子交换汇差-网联待清算资金-借记卡核算专户'
for dd,amt in [(D(2026,9,2),23.5),(D(2026,9,9),23.5),(D(2026,9,16),23.5),(D(2026,10,1),1880.0)]:
    cmb.append((dd,'快捷支付',OPAQUE,-fen(amt),'out'))
    facts.append(dict(date=dd.isoformat(),time='',merchant=OPAQUE,cents=fen(amt),kind='out',src='cmb'))
cmb.append((D(2026,9,25),'快捷退款',OPAQUE,fen(23.5),'in'))
facts.append(dict(date='2026-09-25',time='',merchant=OPAQUE,cents=fen(23.5),kind='in',src='cmb'))
cmb.sort(key=lambda r:r[0])

# ---- 写文件 ----
rows_ali.sort(key=lambda r:r[0]); rows_wx.sort(key=lambda r:r[0])
def fmt_c(c): return f"{c//100:,}.{c%100:02d}"
# 支付宝
out_ali = [r for r in rows_ali if r[5]=='支出']
inc_ali = [r for r in rows_ali if r[5]=='收入']
tot = lambda rs,i=6: round(sum(round(float(r[i].replace(',',''))*100) for r in rs))
allrows = rows_ali + SKIP_ALI
exp_rows = [r for r in allrows if r[5]=='支出' and r[8] != '交易关闭']
hdr = f"""------------------------------------------------------------------------------------
导出信息：
姓名：测试用户
支付宝账户：test***@mail.com
起始时间：[2025-10-01 00:00:00]    终止时间：[2026-10-18 08:00:00]
导出交易类型：[全部]
导出时间：[2026-10-18 08:00:01]
共{len(allrows)}笔记录
收入：{len(inc_ali)}笔 {money(tot(inc_ali))}元
支出：{len(exp_rows)}笔 {money(tot(exp_rows))}元
不计收支：{len([r for r in allrows if r[5]=='不计收支'])}笔 1000.00元

特别提示：
1.本回单内容可表明支付宝受理了相应支付交易申请。
2.（模拟数据，格式依 2026 年公开样例）

------------------------支付宝（中国）网络技术有限公司  电子客户回单------------------------
"""
head = '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,\n'
body = ''.join(','.join(r)+',\n' for r in allrows)
open(f'{OUT}/alipay.csv','wb').write((hdr+head+body).encode('gbk'))
# 微信
exp_wx = [r for r in rows_wx if r[4]=='支出']
inc_wx = [r for r in rows_wx if r[4]=='收入']
def wt(rs): return sum(round(float(r[5].replace('¥','').replace(',',''))*100) for r in rs)
wxhead = f"""微信支付账单明细,,,,,,,,,,
微信昵称：[测试],,,,,,,,,,
起始时间：[2025-10-01 00:00:00] 终止时间：[2026-10-18 08:00:00],,,,,,,,,,
导出类型：[全部],,,,,,,,,,
导出时间：[2026-10-18 08:00:05],,,,,,,,,,
,,,,,,,,,,
共{len(rows_wx)+len(SKIP_WX)}笔记录,,,,,,,,,,
收入：{len(inc_wx)}笔 {money(wt(inc_wx))}元,,,,,,,,,,
支出：{len(exp_wx)}笔 {money(wt(exp_wx))}元,,,,,,,,,,
中性交易：{len(SKIP_WX)}笔 1700.00元,,,,,,,,,,
注：,,,,,,,,,,
1. 充值/提现/理财通购买/零钱通存取/信用卡还款等交易，将计入中性交易,,,,,,,,,,
2. 本明细仅供个人对账使用,,,,,,,,,,
,,,,,,,,,,
----------------------微信支付账单明细列表--------------------,,,,,,,,,,
"""
w = io.StringIO(); cw = csv.writer(w, lineterminator='\n')
for r in rows_wx + SKIP_WX:
    if len(r) == 11: cw.writerow(r)
    else: cw.writerow([r[0],r[1],r[2],r[3],'/',r[5],r[6],r[7],r[8],r[9],r[10]])
cw2 = io.StringIO(); cw3 = csv.writer(cw2, lineterminator='\n')
cw3.writerow('交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注'.split(','))
rows_wx_sorted = sorted(rows_wx + [[r[0],r[1],r[2],r[3],'/',r[5],r[6],r[7],r[8],r[9],r[10]] for r in SKIP_WX], key=lambda r:r[0])
for r in rows_wx_sorted: cw3.writerow(r)
open(f'{OUT}/wechat.csv','wb').write(('\ufeff'+wxhead+cw2.getvalue()).encode('utf-8'))
# 招行
lines = ['招商银行交易流水,,,,,','户名：测试 账号：6214***0000,,,,,','记账日期,货币,交易金额,联机余额,交易摘要,对手信息']
bal = 20000
for d,summ,cp,amt,k in cmb:
    bal += amt
    lines.append(f'{d.isoformat()},CNY,"{fmt_c(abs(amt)) if amt>0 else "-"+fmt_c(abs(amt))}","{fmt_c(bal) if bal>=0 else "-"+fmt_c(-bal)}",{summ},{cp}')
open(f'{OUT}/cmb.csv','wb').write(('\n'.join(lines)+'\n').encode('utf-8'))
# 通用（需手动映射）：自定义列名；含 2 行完全相同的记录（应保留 2 条）
gen = '日子,花在哪,多少钱,类型\n2026-10-01,早餐铺,8.50,支\n2026-10-01,早餐铺,8.50,支\n2026-10-02,公司报销,200.00,收\n2026-10-03,打车,31.20,支\n'
open(f'{OUT}/generic.csv','wb').write(gen.encode('utf-8'))

# ---- 期望：月度（净支出 = 支出 − 退款，退款计入收到当月），不含收入/不计收支/关闭 ----
monthly = {}; src_month = {}
for f in facts:
    if f['kind'] == 'inc': continue
    mth = f['date'][:7]
    s = f['cents'] if f['kind']=='out' else -f['cents']
    monthly[mth] = monthly.get(mth,0)+s
    src_month.setdefault(f['src'],{}); src_month[f['src']][mth] = src_month[f['src']].get(mth,0)+s
exp = dict(monthly_net_cents=dict(sorted(monthly.items())), total_net_cents=sum(monthly.values()),
  counts=dict(ali_out=len([r for r in rows_ali if r[5]=='支出']), ali_in=len(inc_ali), wx_out=len(exp_wx), wx_in=len(inc_wx),
              cmb_rows=len(cmb)),
  sources_month_cents=src_month,
  subs=[
   dict(merchant='奈飞 Netflix',period='month',latest=7200,last='2026-10-05',next='2026-11-05',annual=7200*12),
   dict(merchant='iCloud 50GB',period='month',latest=600,annual=600*12),
   dict(merchant='Spotify',period='month',latest=1500,last='2026-09-20',next='2026-10-20',annual=1500*12),
   dict(merchant='力迈健身',period='month',latest=30000,last='2026-09-30',next='2026-10-31',annual=30000*12),
   dict(merchant='国网电力',period='month',latest=8500,annual=8500*12),
   dict(merchant='迷你健身App',period='month',latest=2500,last='2026-03-08',stopped=True,annual=2500*12),
   dict(merchant='迅捷云盘周卡',period='week',latest=500,last='2026-10-11',next='2026-10-18',annual=500*52),
   dict(merchant='爱奇艺黄金VIP年卡',period='year',latest=19800,last='2026-10-15',next='2027-10-15',annual=19800),
   dict(merchant='房东张三',period='month',latest=350000,last='2026-10-01',next='2026-11-01',annual=350000*12),
  ],
  not_subs=['美团外卖','饿了么','老王面馆','北京地铁','瑞幸咖啡','小米商城','淘宝-某店铺','便利蜂','老李',OPAQUE],
  generic=dict(out_cents=850+850+3120, in_cents=20000, rows=4),
  skipped=dict(ali_neutral=1, ali_closed=1, wx_neutral=2))
json.dump(exp, open(f'{OUT}/expected.json','w'), ensure_ascii=False, indent=1)
print('facts', len(facts), 'total net', exp['total_net_cents']/100, exp['counts'])
