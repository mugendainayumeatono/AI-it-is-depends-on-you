"""
斗鱼弹幕发送工具 (Chrome Remote Debugging 版)

自动启动带调试端口的 Chrome，连接斗鱼直播间，输入/发送弹幕。

使用方法:
    python douyu_send_danmu.py                  # 默认房间 9046690，交互模式
    python douyu_send_danmu.py 9046690           # 指定房间号
    python douyu_send_danmu.py 9046690 "测试"    # 发送单条弹幕
"""

import sys
import os
import json
import time
import subprocess
import socket
import requests
import websocket
import atexit

# 修复 Windows 控制台编码
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def find_chrome():
    """查找 Chrome 可执行文件"""
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("LocalAppData", ""), "Google", "Chrome", "Application", "chrome.exe"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return "chrome.exe"  # fallback to PATH


def find_free_port(start=9222, end=9300):
    """查找可用端口"""
    for port in range(start, end):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start


def is_cdp_available(port):
    """检查 CDP 调试端口是否可用"""
    try:
        resp = requests.get(f"http://127.0.0.1:{port}/json/version", timeout=2)
        return resp.status_code == 200
    except Exception:
        return False


class ChromeDebugger:
    """通过 Chrome DevTools Protocol (CDP) 控制浏览器"""

    def __init__(self, port=9222, auto_launch=True, start_url=None):
        self.port = port
        self.base_url = f"http://127.0.0.1:{port}"
        self.ws = None
        self.msg_id = 0
        self.chrome_process = None
        atexit.register(self.kill_chrome)

        if not is_cdp_available(port):
            if auto_launch:
                self._launch_chrome(start_url)
            else:
                print("[ERROR] 无法连接到 Chrome 调试端口")
                sys.exit(1)

        self._fetch_tabs()

    def _launch_chrome(self, start_url=None):
        """自动启动带调试端口的 Chrome"""
        chrome_path = find_chrome()
        # 使用独立的用户数据目录，避免与已运行的 Chrome 冲突
        profile_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".chrome_debug_profile")

        # 如果默认端口被占用（但不是 CDP），换一个端口
        if not is_cdp_available(self.port):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(("127.0.0.1", self.port))
                except OSError:
                    self.port = find_free_port(self.port + 1)
                    self.base_url = f"http://127.0.0.1:{self.port}"

        args = [
            chrome_path,
            f"--remote-debugging-port={self.port}",
            f"--user-data-dir={profile_dir}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
        ]
        if start_url:
            args.append(start_url)

        print(f"[INFO] 正在启动 Chrome (调试端口: {self.port})...")
        self.chrome_process = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # 等待 CDP 就绪
        for i in range(30):
            time.sleep(1)
            if is_cdp_available(self.port):
                print(f"[OK] Chrome 已启动")
                return
        print("[ERROR] Chrome 启动超时")
        sys.exit(1)

    def _fetch_tabs(self):
        """获取标签页列表"""
        # 尝试多个 endpoint
        for path in ["/json", "/json/list"]:
            try:
                resp = requests.get(f"{self.base_url}{path}", timeout=3)
                if resp.status_code == 200:
                    self.tabs = resp.json()
                    print(f"[OK] 已连接到 Chrome (找到 {len(self.tabs)} 个标签页)")
                    return
            except Exception:
                continue

        print("[ERROR] 无法获取标签页列表")
        sys.exit(1)

    def list_tabs(self):
        """列出所有标签页"""
        self._fetch_tabs()
        pages = [t for t in self.tabs if t.get("type") == "page"]
        for i, tab in enumerate(pages):
            title = tab.get("title", "无标题")
            url = tab.get("url", "")
            print(f"  [{i}] {title}")
            print(f"      {url}")
        return pages

    def attach(self, tab_index=0):
        """附加到指定标签页"""
        pages = [t for t in self.tabs if t.get("type") == "page"]
        if tab_index >= len(pages):
            print(f"[ERROR] 标签页索引 {tab_index} 超出范围 (共 {len(pages)} 个)")
            return False

        tab = pages[tab_index]
        ws_url = tab.get("webSocketDebuggerUrl")
        if not ws_url:
            print("[ERROR] 无法获取 WebSocket 调试地址")
            return False

        self.ws = websocket.create_connection(ws_url, timeout=10)
        print(f"[OK] 已附加到: {tab.get('title', '无标题')}")
        return True

    def attach_to_douyu(self, room_id=None):
        """自动查找并附加到斗鱼标签页"""
        self._fetch_tabs()
        pages = [t for t in self.tabs if t.get("type") == "page"]

        # 优先查找匹配房间号的斗鱼页面
        for i, tab in enumerate(pages):
            url = tab.get("url", "")
            if "douyu.com" in url:
                if room_id and str(room_id) not in url:
                    continue
                return self.attach(i)

        # 查找任意斗鱼页面
        for i, tab in enumerate(pages):
            url = tab.get("url", "")
            if "douyu.com" in url:
                return self.attach(i)

        # 未找到，在第一个标签页打开
        if room_id and pages:
            print(f"[INFO] 未找到斗鱼页面，正在打开房间 {room_id}...")
            self.attach(0)
            self.navigate(f"https://www.douyu.com/{room_id}")
            time.sleep(5)
            return True

        print("[ERROR] 未找到斗鱼直播间标签页")
        return False

    def send_cdp(self, method, params=None):
        """发送 CDP 命令并等待响应"""
        self.msg_id += 1
        msg = {"id": self.msg_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(msg))

        while True:
            resp = json.loads(self.ws.recv())
            if resp.get("id") == self.msg_id:
                if "error" in resp:
                    raise Exception(f"CDP Error: {resp['error']}")
                return resp.get("result", {})

    def navigate(self, url):
        """导航到指定 URL"""
        self.send_cdp("Page.navigate", {"url": url})
        print(f"[INFO] 正在打开: {url}")

    def evaluate(self, expression):
        """执行 JavaScript 并返回结果"""
        result = self.send_cdp("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": False,
        })
        remote = result.get("result", {})
        if remote.get("type") == "undefined":
            return None
        return remote.get("value", remote.get("description"))

    def kill_chrome(self):
        """确保在程序异常退出时清理进程"""
        if self.chrome_process and self.chrome_process.poll() is None:
            print("[INFO] 正在关闭后台 Chrome 进程...")
            self.chrome_process.terminate()
            self.chrome_process.wait()

    def close(self):
        """关闭 WebSocket 连接并清理进程"""
        if self.ws:
            self.ws.close()
        self.kill_chrome()


class DouyuDanmuSender:
    """斗鱼弹幕发送器"""

    def __init__(self, room_id=None, port=9222):
        self.room_id = str(room_id) if room_id else None
        start_url = f"https://www.douyu.com/{self.room_id}" if self.room_id else None
        self.chrome = ChromeDebugger(port=port, auto_launch=False, start_url=start_url)

    def connect(self):
        """连接到斗鱼直播间标签页"""
        if not self.chrome.attach_to_douyu(self.room_id):
            sys.exit(1)

        time.sleep(2)

        # 获取页面标题
        title = self.chrome.evaluate("document.title")
        print(f"[INFO] 当前页面: {title}")

        # 检查弹幕输入框
        has_input = self.chrome.evaluate("""
            !!document.querySelector('.ChatSend-txt') || 
            !!document.querySelector('[class*="ChatSend"] textarea')
        """)
        if has_input:
            print("[OK] 弹幕输入框已就绪")
        else:
            print("[WARN] 未检测到弹幕输入框（可能需要登录或页面未完全加载）")

        return self

    def input_text(self, text):
        """在弹幕输入框中输入文字（不发送）"""
        js = f"""
        (function() {{
            var el = document.querySelector('.ChatSend-txt');
            if (!el) el = document.querySelector('[class*="ChatSend"] textarea');
            if (!el) el = document.querySelector('[class*="ChatSend"] input');
            if (!el) return 'NOT_FOUND';
            el.focus();
            var nativeInputValueSetter = null;
            if (window.HTMLTextAreaElement) {
                var desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
                if (desc) nativeInputValueSetter = desc.set;
            }
            if (!nativeInputValueSetter && window.HTMLInputElement) {
                var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
                if (desc) nativeInputValueSetter = desc.set;
            }
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(el, {json.dumps(text)});
            } else {
                el.value = {json.dumps(text)};
                el.innerText = {json.dumps(text)};
            }
            el.dispatchEvent(new Event('input', {{bubbles: true}}));
            return 'OK';
        }})()
        """
        result = self.chrome.evaluate(js)
        if result == "OK":
            print(f"[INPUT] 已输入: {text}")
            return True
        else:
            print("[ERROR] 找不到弹幕输入框")
            return False

    def send_danmu(self, text):
        """输入并发送弹幕"""
        js = f"""
        (function() {{
            var el = document.querySelector('.ChatSend-txt');
            if (!el) el = document.querySelector('[class*="ChatSend"] textarea');
            if (!el) el = document.querySelector('[class*="ChatSend"] input');
            if (!el) return 'INPUT_NOT_FOUND';
            
            el.focus();
            var nativeInputValueSetter = null;
            if (window.HTMLTextAreaElement) {
                var desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
                if (desc) nativeInputValueSetter = desc.set;
            }
            if (!nativeInputValueSetter && window.HTMLInputElement) {
                var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
                if (desc) nativeInputValueSetter = desc.set;
            }
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(el, {json.dumps(text)});
            } else {
                el.value = {json.dumps(text)};
                el.innerText = {json.dumps(text)};
            }
            el.dispatchEvent(new Event('input', {{bubbles: true}}));
            
            // 查找发送按钮
            var btn = document.querySelector('.ChatSend-button');
            if (!btn) {{
                var all = document.querySelectorAll('[class*="ChatSend"] button, [class*="ChatSend"] div');
                for (var b of all) {{
                    if (b.innerText.trim() === '发送') {{ btn = b; break; }}
                }}
            }}
            
            if (btn) {{
                btn.click();
                return 'SENT';
            }}
            return 'BTN_NOT_FOUND';
        }})()
        """
        result = self.chrome.evaluate(js)
        if result == "SENT":
            print(f"[SENT] 已发送: {text}")
            return True
        elif result == "INPUT_NOT_FOUND":
            print("[ERROR] 找不到弹幕输入框")
            return False
        elif result == "BTN_NOT_FOUND":
            print(f"[WARN] 已输入但未找到发送按钮: {text}")
            return False
        return False

    def screenshot(self, filename=None):
        """截取页面截图"""
        import base64
        result = self.chrome.send_cdp("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(result["data"])
        if not filename:
            filename = f"douyu_{self.room_id or 'room'}_{int(time.time())}.png"
        with open(filename, "wb") as f:
            f.write(data)
        print(f"[SCREENSHOT] 截图已保存: {filename}")

    def interactive(self):
        """交互式弹幕发送"""
        print()
        print("=" * 50)
        print("  斗鱼弹幕发送工具 - 交互模式")
        print("=" * 50)
        print("命令:")
        print("  直接输入文字   -> 发送弹幕")
        print("  /input 文字    -> 仅输入不发送")
        print("  /screenshot    -> 截图")
        print("  /tabs          -> 列出标签页")
        print("  /quit          -> 退出")
        print("=" * 50)
        print()

        while True:
            try:
                text = input("danmu> ").strip()
                if not text:
                    continue

                if text in ("/quit", "/exit"):
                    break
                elif text == "/screenshot":
                    self.screenshot()
                elif text == "/tabs":
                    self.chrome.list_tabs()
                elif text.startswith("/input "):
                    self.input_text(text[7:])
                else:
                    self.send_danmu(text)
                    time.sleep(1)

            except (KeyboardInterrupt, EOFError):
                print()
                break

    def close(self):
        """关闭连接（不关闭浏览器）"""
        self.chrome.close()
        print("[INFO] 调试连接已断开（浏览器保持打开）")


def main():
    room_id = "9046690"
    single_msg = None

    if len(sys.argv) > 1:
        room_id = sys.argv[1]
    if len(sys.argv) > 2:
        single_msg = sys.argv[2]

    sender = DouyuDanmuSender(room_id)

    try:
        sender.connect()

        if single_msg:
            sender.input_text(single_msg)
            sender.screenshot()
        else:
            sender.interactive()

    except KeyboardInterrupt:
        print("\n[INFO] 用户中断")
    finally:
        sender.close()


if __name__ == "__main__":
    main()
