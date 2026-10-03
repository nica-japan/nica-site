#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DNSの引っ越し前に、移行元と移行先のレコードが一致するか照合する。

  python3 check_dns.py

ネームサーバーを切り替えると、移行先(01.dnsv.jp)の内容がそのまま本番になる。
内容が違っているとメールが止まるため、切り替える前に必ずこれで確認する。

  移行元  ns-rs1.gmoserver.jp （レンタルサーバーのDNS。解約すると消える）
  移行先  01.dnsv.jp          （お名前.comのDNS。サーバー契約に依存しない）

「すべて一致」と出てから、ネームサーバーを 01〜04.dnsv.jp に変更する。
切り替えが済んだら、このスクリプトは削除してよい。
"""
import subprocess, re, sys, base64

D = "nica-japan.jp"
OLD, NEW = "ns-rs1.gmoserver.jp", "01.dnsv.jp"
TARGETS = [
    (D, "A"), ("www."+D, "A"), ("mail."+D, "A"), ("ml-cp."+D, "A"),
    (D, "MX"), (D, "TXT"), ("default._domainkey."+D, "TXT"),
]

def q(ns, host, rtype):
    out = subprocess.run(["dig", "+short", f"@{ns}", host, rtype],
                         capture_output=True, text=True, timeout=20).stdout
    vals = []
    for line in out.strip().split("\n"):
        if not line: continue
        if rtype == "TXT":
            line = "".join(re.findall(r'"([^"]*)"', line)) or line
        vals.append(line.rstrip("."))
    return sorted(vals)

print(f"{'レコード':<34} {'照合':<6} 内容")
print("-" * 78)
ok = ng = pending = 0
for host, rtype in TARGETS:
    o, n = q(OLD, host, rtype), q(NEW, host, rtype)
    label = f"[{rtype}] {host}"
    if not n:
        print(f"{label:<34} {'未反映':<6} （移行先にまだ無し）"); pending += 1
    elif o == n:
        shown = (n[0][:40] + "…") if len(n[0]) > 40 else n[0]
        print(f"{label:<34} {'一致':<6} {shown}"); ok += 1
    else:
        print(f"{label:<34} {'不一致':<5}")
        print(f"{'':<34} 旧: {o}")
        print(f"{'':<34} 新: {n}"); ng += 1

# DKIM の中身を厳密に検査
dk = q(NEW, "default._domainkey."+D, "TXT")
print("-" * 78)
if dk:
    v = dk[0]
    m = re.search(r"p=([A-Za-z0-9+/=]+)", v)
    print(f"DKIM 文字数: {len(v)}（期待値 410）")
    if m:
        try:
            der = base64.b64decode(m.group(1), validate=True)
            print(f"DKIM 鍵    : 正常にデコード（{len(der)}バイト ≒ RSA 2048bit）")
        except Exception as e:
            print(f"DKIM 鍵    : デコード失敗 {e}"); ng += 1
    else:
        print("DKIM 鍵    : p= が見つからない"); ng += 1

print()
print(f"一致 {ok} / 不一致 {ng} / 未反映 {pending}")
if pending: print("→ まだ反映途中です。数時間後にもう一度実行してください。")
elif ng: print("→ 不一致があります。ネームサーバーは変更しないでください。")
else: print("→ すべて一致。ネームサーバーを変更して問題ありません。")
sys.exit(1 if (ng or pending) else 0)
