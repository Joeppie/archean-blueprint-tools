#!/usr/bin/env python3
"""Real-time perf probe for the viewer (dev tool).

Headless chromium's --virtual-time-budget freezes clocks and rAF cadence, so
?perf titles (fps, per-frame ms) are meaningless under it. This tool launches
headless chromium WITHOUT virtual time and polls document.title over real wall
clock via the DevTools protocol (hand-rolled websocket, no dependencies),
so you get the live browser's own numbers (iGPU-pinned by default).

Usage:
  tools/perfprobe.py URL [seconds]      # default 12 s, prints title samples
Environment:
  VK_ICD_FILENAMES  (default: AMD iGPU — never contend the user's AI GPU)
"""
import json
import os
import base64
import socket
import struct
import subprocess
import sys
import time
import urllib.request

PORT = 9333


def ws_connect(ws_url):
    """Minimal websocket client-frame handshake + single text I/O."""
    # ws://127.0.0.1:PORT/devtools/page/ID
    path = ws_url.split(str(PORT), 1)[1]
    s = socket.create_connection(("127.0.0.1", PORT), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((
        f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(4096)
    return s


def ws_send(s, obj):
    data = json.dumps(obj).encode()
    hdr = bytearray([0x81])
    n = len(data)
    mask = os.urandom(4)
    if n < 126:
        hdr.append(0x80 | n)
    elif n < 65536:
        hdr.append(0x80 | 126)
        hdr += struct.pack(">H", n)
    else:
        hdr.append(0x80 | 127)
        hdr += struct.pack(">Q", n)
    s.sendall(bytes(hdr) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def ws_recv_text(s, want_id, t_end):
    """Read frames until a response with id==want_id arrives."""
    s.settimeout(max(0.1, t_end - time.time()))
    buf = b""
    while time.time() < t_end:
        try:
            buf += s.recv(65536)
        except socket.timeout:
            break
        while True:
            if len(buf) < 2:
                break
            ln = buf[1] & 0x7F
            off = 2
            if ln == 126:
                ln = struct.unpack(">H", buf[2:4])[0]
                off = 4
            elif ln == 127:
                ln = struct.unpack(">Q", buf[2:10])[0]
                off = 10
            if len(buf) < off + ln:
                break
            payload, buf = buf[off:off + ln], buf[off + ln:]
            try:
                m = json.loads(payload)
            except Exception:
                continue
            if m.get("id") == want_id:
                return m
    return None


def main():
    url = sys.argv[1]
    secs = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    env = dict(os.environ)
    env.setdefault("VK_ICD_FILENAMES", "/usr/share/vulkan/icd.d/radeon_icd.json")
    proc = subprocess.Popen(
        ["chromium", "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
         "--use-gl=angle", "--use-angle=vulkan", "--window-size=1400,900",
         f"--remote-debugging-port={PORT}", url],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        # wait for a page target
        target = None
        t0 = time.time()
        while time.time() - t0 < 25:
            time.sleep(0.4)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2) as r:
                    tabs = json.load(r)
                pages = [t for t in tabs if t.get("type") == "page" and "index.html" in t.get("url", "")]
                if pages:
                    target = pages[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass
        if not target:
            print("no page target")
            return 1
        s = ws_connect(target)
        last = ""
        t0 = time.time()
        mid = []
        midn = 0
        ws_send(s, {"id": 1, "method": "Runtime.enable"})
        while time.time() - t0 < secs:
            time.sleep(0.6)
            ws_send(s, {"id": 2, "method": "Runtime.evaluate",
                        "params": {"expression": "document.title", "returnByValue": True}})
            m = ws_recv_text(s, 2, time.time() + 1.5)
            t = (m or {}).get("result", {}).get("result", {}).get("value", "")
            if t == last:
                midn += 1
            else:
                if last:
                    mid.append((round(time.time() - t0, 1), last))
                last = t
        mid.append((round(time.time() - t0, 1), last))
        print("timeline:")
        for tt, t in mid:
            print(f"  t={tt:5.1f}s  {t}")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
