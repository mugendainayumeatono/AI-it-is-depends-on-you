import struct
import json
import websocket
import threading
import time
import queue
import tkinter as tk
from tkinter import ttk, scrolledtext
import ssl
import os
import urllib.request
from collections import deque

class DouyuDanmakuGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("斗鱼弹幕助手")
        self.root.geometry("750x600")
        
        # Room ID & client state
        self.room_id = tk.StringVar(value="9999")
        self.ws = None
        self.is_connected = False
        self.stop_event = threading.Event()
        
        # Room history
        self.history_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "douyu_rooms.json")
        self.room_history = self.load_history()  # [{"room_id": "9999", "owner": "主播名"}]
        
        # Thread-safe message queue
        self.msg_queue = queue.Queue()
        
        # Message filter states
        self.filter_chat = tk.BooleanVar(value=True)
        self.filter_gift = tk.BooleanVar(value=True)
        self.filter_enter = tk.BooleanVar(value=False)
        self.filter_global = tk.BooleanVar(value=True)
        
        # Per-type timestamp deques for rate calculation
        self.msg_timestamps = {
            "chatmsg": deque(),
            "dgb": deque(),
            "uenter": deque(),
            "spbc": deque(),
        }
        
        self.setup_styles()
        self.setup_ui()
        
        # Start queue poller
        self.root.after(100, self.poll_queue)
        self.root.after(1000, self.update_stats)
        
        # Handle window close
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def setup_styles(self):
        """Set up dark mode theme styles"""
        self.bg_color = "#1e1e1e"
        self.fg_color = "#e0e0e0"
        self.accent_color = "#00adb5"  # Teal
        self.btn_bg = "#393e46"
        self.text_bg = "#252526"
        
        # Configure root background
        self.root.configure(bg=self.bg_color)
        
        # Configure TTK styles
        self.style = ttk.Style()
        self.style.theme_use("clam")
        
        # Configure frames
        self.style.configure("TFrame", background=self.bg_color)
        
        # Configure Entry
        self.style.configure("TEntry", fieldbackground=self.text_bg, foreground=self.fg_color, insertcolor=self.fg_color)
        
        # Configure Label
        self.style.configure("TLabel", background=self.bg_color, foreground=self.fg_color, font=("Microsoft YaHei", 10))
        self.style.configure("Status.TLabel", font=("Microsoft YaHei", 10, "bold"))
        
        # Checkbutton style
        self.style.configure("Filter.TCheckbutton",
            background=self.bg_color,
            foreground=self.fg_color,
            font=("Microsoft YaHei", 9),
            indicatorbackground=self.text_bg,
            indicatorforeground=self.accent_color
        )
        self.style.map("Filter.TCheckbutton",
            background=[("active", self.bg_color)],
            foreground=[("active", self.accent_color)]
        )

    def setup_ui(self):
        """Build the UI layout"""
        # --- Top control panel ---
        self.control_frame = ttk.Frame(self.root, padding=10)
        self.control_frame.pack(fill=tk.X)
        
        # Room ID Label
        self.room_label = ttk.Label(self.control_frame, text="房间号:")
        self.room_label.pack(side=tk.LEFT, padx=(0, 5))
        
        # Room ID Combobox (editable - user can type new room ID or pick from history)
        self.room_combo = ttk.Combobox(
            self.control_frame, textvariable=self.room_id, width=22,
            font=("Microsoft YaHei", 10)
        )
        self.room_combo.pack(side=tk.LEFT, padx=(0, 10))
        self.room_combo.bind("<<ComboboxSelected>>", self.on_combobox_select)
        self.refresh_combobox()
        
        # Connect Button
        self.btn_connect = tk.Button(
            self.control_frame, 
            text="开始连接", 
            command=self.toggle_connection,
            bg=self.accent_color,
            fg="#ffffff",
            activebackground="#008f95",
            activeforeground="#ffffff",
            font=("Microsoft YaHei", 10, "bold"),
            relief=tk.FLAT,
            padx=15,
            pady=3
        )
        self.btn_connect.pack(side=tk.LEFT, padx=(0, 15))
        
        # Connection Status Label
        self.status_label = ttk.Label(self.control_frame, text="状态: 未连接", style="Status.TLabel", foreground="#888888")
        self.status_label.pack(side=tk.LEFT)
        
        # --- Filter bar ---
        self.filter_frame = ttk.Frame(self.root, padding=(10, 2))
        self.filter_frame.pack(fill=tk.X)
        
        filter_label = ttk.Label(self.filter_frame, text="消息过滤:", font=("Microsoft YaHei", 9, "bold"))
        filter_label.pack(side=tk.LEFT, padx=(0, 8))
        
        filters = [
            ("💬 弹幕", self.filter_chat),
            ("🎁 礼物", self.filter_gift),
            ("🚪 进入", self.filter_enter),
            ("📢 广播", self.filter_global),
        ]
        for text, var in filters:
            cb = ttk.Checkbutton(self.filter_frame, text=text, variable=var, style="Filter.TCheckbutton")
            cb.pack(side=tk.LEFT, padx=(0, 12))
        
        # Separator + stats label on the right
        self.stats_label = ttk.Label(
            self.filter_frame, text="📊 0 条/分钟",
            font=("Microsoft YaHei", 9, "bold"),
            foreground=self.accent_color
        )
        self.stats_label.pack(side=tk.RIGHT, padx=(10, 0))
        
        # --- ScrolledText for showing danmaku ---
        self.text_frame = ttk.Frame(self.root, padding=10)
        self.text_frame.pack(fill=tk.BOTH, expand=True)
        
        self.text_area = scrolledtext.ScrolledText(
            self.text_frame, 
            bg=self.text_bg, 
            fg=self.fg_color, 
            insertbackground=self.fg_color,
            font=("Microsoft YaHei", 11),
            wrap=tk.WORD,
            state=tk.DISABLED
        )
        self.text_area.pack(fill=tk.BOTH, expand=True)
        
        # Add text tags for coloring
        self.text_area.tag_configure("sys", foreground="#888888")
        self.text_area.tag_configure("level", foreground="#ffb344")
        self.text_area.tag_configure("user", foreground="#00adb5", font=("Microsoft YaHei", 11, "bold"))
        self.text_area.tag_configure("danmu", foreground="#e0e0e0")
        self.text_area.tag_configure("gift", foreground="#ff2e63", font=("Microsoft YaHei", 11, "bold"))
        self.text_area.tag_configure("enter", foreground="#4e9f3d")
        self.text_area.tag_configure("global", foreground="#f8065a")

    def log(self, text, tag="sys"):
        """Print log messages helper"""
        self.msg_queue.put(("log", (text, tag)))

    def toggle_connection(self):
        if self.is_connected:
            self.disconnect()
        else:
            self.connect()

    def connect(self):
        # Extract room_id: could be raw number or "owner (12345)" format
        raw = self.room_id.get().strip()
        if '(' in raw and raw.endswith(')'):
            rid = raw.rsplit('(', 1)[-1].rstrip(')')
        else:
            rid = raw
        if not rid.isdigit():
            return
        
        self.is_connected = True
        self.btn_connect.configure(text="断开连接", bg="#ff2e63", activebackground="#e0224f")
        self.status_label.configure(text="状态: 正在连接...", foreground="#ffb344")
        
        # Start connection in a background thread
        threading.Thread(target=self.ws_thread, args=(rid,), daemon=True).start()

    def disconnect(self):
        self.is_connected = False
        self.stop_event.set()
        if self.ws:
            self.ws.close()
        self.btn_connect.configure(text="开始连接", bg=self.accent_color, activebackground="#008f95")
        self.status_label.configure(text="状态: 未连接", foreground="#888888")

    def encode_packet(self, msg_type, content):
        data = (content + "\x00").encode('utf-8')
        packet_len = 8 + len(data)
        header = struct.pack("<IIHBB", packet_len, packet_len, msg_type, 0, 0)
        return header + data

    def decode_packet(self, packet_bytes):
        if len(packet_bytes) < 12:
            return None
        try:
            packet_len, _, msg_type, _, _ = struct.unpack("<IIHBB", packet_bytes[:12])
            content = packet_bytes[12:12 + packet_len - 8].decode('utf-8', errors='ignore').rstrip('\x00')
            return content
        except Exception:
            return None

    def parse_stt(self, stt_str):
        result = {}
        for item in stt_str.split('/'):
            if not item:
                continue
            parts = item.split('@=')
            if len(parts) == 2:
                key, val = parts
                val = val.replace('@S', '/').replace('@A', '@')
                result[key] = val
        return result

    def ws_thread(self, room_id):
        url = "wss://danmuproxy.douyu.com:8506/"
        header = [
            "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin: https://www.douyu.com"
        ]
        
        context = ssl.create_default_context()
        
        def on_open(ws):
            self.msg_queue.put(("status", ("已连接", "#4e9f3d")))
            self.log(f"已成功建立连接，正在加入房间 {room_id}...", "sys")
            # Login
            ws.send(self.encode_packet(689, f"type@=loginreq/roomid@={room_id}/"), opcode=websocket.ABNF.OPCODE_BINARY)
            # Join group
            ws.send(self.encode_packet(689, f"type@=joingroup/rid@={room_id}/gid@=-9999/"), opcode=websocket.ABNF.OPCODE_BINARY)
            
            # Fetch room owner name via API and save to history
            threading.Thread(target=self.fetch_and_save_room, args=(room_id,), daemon=True).start()
            
            # Keepalive heartbeat
            def heartbeat():
                while self.is_connected and not self.stop_event.is_set():
                    if self.stop_event.wait(45):
                        break
                    try:
                        ws.send(self.encode_packet(689, "type@=mrkl/"), opcode=websocket.ABNF.OPCODE_BINARY)
                    except Exception:
                        break
            threading.Thread(target=heartbeat, daemon=True).start()

        def on_message(ws, message):
            content = self.decode_packet(message)
            if not content:
                return
            
            msg = self.parse_stt(content)
            msg_type = msg.get('type')
            
            if msg_type == 'chatmsg':
                level = msg.get('level', '0')
                nickname = msg.get('nn', 'Unknown')
                txt = msg.get('txt', '')
                self.msg_queue.put(("chatmsg", (level, nickname, txt)))
            elif msg_type == 'dgb':
                nickname = msg.get('nn', 'Unknown')
                gfid = msg.get('gfid', '')
                gfcnt = msg.get('gfcnt', '1')
                hits = msg.get('hits', '1')
                gift_names = {
                    "191": "鱼丸", "192": "赞", "193": "弱鸡", "519": "发光荧光棒",
                    "520": "稳", "1005": "超级火箭", "195": "飞机", "196": "火箭"
                }
                gift_name = gift_names.get(gfid, f"礼物ID:{gfid}")
                self.msg_queue.put(("dgb", (nickname, gift_name, gfcnt, hits)))
            elif msg_type == 'uenter':
                nickname = msg.get('nn', 'Unknown')
                self.msg_queue.put(("uenter", (nickname,)))
            elif msg_type == 'spbc':
                sn = msg.get('sn', '')
                gn = msg.get('gn', '')
                dn = msg.get('dn', '')
                self.msg_queue.put(("spbc", (sn, gn, dn)))

        def on_error(ws, error):
            self.log(f"连接异常: {error}", "sys")
            self.msg_queue.put(("disconnected_err", ()))

        def on_close(ws, status, msg):
            self.log("连接已断开", "sys")
            self.msg_queue.put(("status", ("未连接", "#888888")))

        self.ws = websocket.WebSocketApp(
            url,
            header=header,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close
        )
        
        self.ws.run_forever(sslopt={"context": context})

    def poll_queue(self):
        """Process messages in the queue to update GUI safely from main thread"""
        try:
            while True:
                msg_type, msg_data = self.msg_queue.get_nowait()
                
                self.text_area.configure(state=tk.NORMAL)
                if msg_type == "log":
                    text, tag = msg_data
                    self.text_area.insert(tk.END, f"{text}\n", tag)
                elif msg_type == "status":
                    self.status_label.configure(text=f"状态: {msg_data[0]}", foreground=msg_data[1])
                elif msg_type == "disconnected_err":
                    self.disconnect()
                elif msg_type == "chatmsg":
                    self.msg_timestamps["chatmsg"].append(time.time())
                    if not self.filter_chat.get():
                        self.text_area.configure(state=tk.DISABLED)
                        continue
                    level, nickname, text = msg_data
                    self.text_area.insert(tk.END, f"[LV.{level:<2}] ", "level")
                    self.text_area.insert(tk.END, f"{nickname}: ", "user")
                    self.text_area.insert(tk.END, f"{text}\n", "danmu")
                elif msg_type == "dgb":
                    self.msg_timestamps["dgb"].append(time.time())
                    if not self.filter_gift.get():
                        self.text_area.configure(state=tk.DISABLED)
                        continue
                    nickname, gift_name, count, hits = msg_data
                    self.text_area.insert(tk.END, f"[礼物] {nickname} 送出 {gift_name} x {count} ", "gift")
                    self.text_area.insert(tk.END, f"(连击: {hits})\n", "sys")
                elif msg_type == "uenter":
                    self.msg_timestamps["uenter"].append(time.time())
                    if not self.filter_enter.get():
                        self.text_area.configure(state=tk.DISABLED)
                        continue
                    nickname = msg_data[0]
                    self.text_area.insert(tk.END, f"[进入] {nickname} 进入了直播间\n", "enter")
                elif msg_type == "spbc":
                    self.msg_timestamps["spbc"].append(time.time())
                    if not self.filter_global.get():
                        self.text_area.configure(state=tk.DISABLED)
                        continue
                    sn, gn, dn = msg_data
                    self.text_area.insert(tk.END, f"[广播] {sn} 赠送给 {dn} 一个大大的 【{gn}】！\n", "global")
                
                # Limit maximum lines to prevent memory leak and lag
                line_count = int(self.text_area.index('end-1c').split('.')[0])
                if line_count > 500:
                    self.text_area.delete('1.0', f'{line_count - 450}.0')
                
                self.text_area.see(tk.END)
                self.text_area.configure(state=tk.DISABLED)
                
        except queue.Empty:
            pass
            
        # Re-schedule poller
        self.root.after(100, self.poll_queue)

    def update_stats(self):
        """Calculate and display messages per minute for selected filter types"""
        now = time.time()
        cutoff = now - 60
        
        # Map msg types to their filter vars
        type_filter = {
            "chatmsg": self.filter_chat,
            "dgb": self.filter_gift,
            "uenter": self.filter_enter,
            "spbc": self.filter_global,
        }
        
        total = 0
        for mtype, dq in self.msg_timestamps.items():
            # Prune old entries
            while dq and dq[0] < cutoff:
                dq.popleft()
            # Only count if this type's filter is checked
            if type_filter[mtype].get():
                total += len(dq)
        
        self.stats_label.configure(text=f"📊 {total} 条/分钟")
        self.root.after(1000, self.update_stats)

    # --- Room history management ---
    def load_history(self):
        """Load room history from JSON file"""
        if os.path.exists(self.history_file):
            try:
                with open(self.history_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def save_history(self):
        """Save room history to JSON file"""
        try:
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump(self.room_history, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def refresh_combobox(self):
        """Update combobox dropdown values from history"""
        display_list = [f"{r['owner']}  ({r['room_id']})" for r in self.room_history]
        self.room_combo['values'] = display_list

    def on_combobox_select(self, event=None):
        """When user picks from dropdown, set room_id var to just the room number"""
        selected = self.room_combo.get()
        if '(' in selected and selected.endswith(')'):
            rid = selected.rsplit('(', 1)[-1].rstrip(')')
            self.room_id.set(rid)

    def fetch_and_save_room(self, room_id):
        """Fetch room owner name from Douyu API and save to history"""
        owner = f"房间{room_id}"
        try:
            url = f"https://open.douyucdn.cn/api/RoomApi/room/{room_id}"
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data.get('error') == 0 and 'data' in data:
                    owner = data['data'].get('owner_name', owner)
        except Exception:
            pass
        
        # Update or insert into history
        for entry in self.room_history:
            if entry['room_id'] == room_id:
                entry['owner'] = owner
                break
        else:
            self.room_history.insert(0, {'room_id': room_id, 'owner': owner})
        
        self.save_history()
        # Refresh combobox on main thread
        self.root.after(0, self.refresh_combobox)
        self.log(f"已记录房间: {owner} ({room_id})", "sys")

    def on_close(self):
        self.is_connected = False
        self.stop_event.set()
        if self.ws:
            self.ws.close()
        self.root.destroy()

if __name__ == "__main__":
    root = tk.Tk()
    app = DouyuDanmakuGUI(root)
    root.mainloop()