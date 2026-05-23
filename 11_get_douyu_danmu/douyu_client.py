import websocket
import ssl
import struct
import threading
import time
import sys

# Ensure UTF-8 output on Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

class Colors:
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    RED = "\033[91m"
    RESET = "\033[0m"
    BOLD = "\033[1m"

class DouyuDanmakuClient:
    def __init__(self, room_id):
        self.room_id = room_id
        self.url = "wss://danmuproxy.douyu.com:8506/"
        self.ws = None

    def encode_packet(self, msg_type, content):
        """Encode STT string to Douyu custom binary packet"""
        data = (content + "\x00").encode('utf-8')
        packet_len = 8 + len(data)
        # Format: <I (little-endian 32-bit), <I, <H (little-endian 16-bit), B (unsigned char), B
        header = struct.pack("<IIHBB", packet_len, packet_len, msg_type, 0, 0)
        return header + data

    def decode_packet(self, packet_bytes):
        """Decode Douyu custom binary packet"""
        if len(packet_bytes) < 12:
            return None
        try:
            packet_len, _, msg_type, _, _ = struct.unpack("<IIHBB", packet_bytes[:12])
            content = packet_bytes[12:12 + packet_len - 8].decode('utf-8', errors='ignore').rstrip('\x00')
            return content
        except Exception:
            return None

    def parse_stt(self, stt_str):
        """Deserialize STT string to dictionary"""
        result = {}
        for item in stt_str.split('/'):
            if not item:
                continue
            parts = item.split('@=')
            if len(parts) == 2:
                key, val = parts
                # Unescape special characters
                val = val.replace('@S', '/').replace('@A', '@')
                result[key] = val
        return result

    def on_message(self, ws, message):
        content = self.decode_packet(message)
        if not content:
            return
        
        msg = self.parse_stt(content)
        msg_type = msg.get('type')
        
        if msg_type == 'chatmsg':
            level = msg.get('level', '0')
            nickname = msg.get('nn', 'Unknown')
            txt = msg.get('txt', '')
            print(f"{Colors.GREEN}[LV.{level:<2}]{Colors.RESET} {Colors.CYAN}{nickname}{Colors.RESET}: {txt}")
        elif msg_type == 'dgb':
            nickname = msg.get('nn', 'Unknown')
            gfid = msg.get('gfid', '')
            gfcnt = msg.get('gfcnt', '1')
            hits = msg.get('hits', '1')
            # Mapping some common gifts
            gift_names = {
                "191": "鱼丸",
                "192": "赞",
                "193": "弱鸡",
                "519": "发光荧光棒",
                "520": "稳",
                "1005": "超级火箭",
                "195": "飞机",
                "196": "火箭"
            }
            gift_name = gift_names.get(gfid, f"礼物ID:{gfid}")
            print(f"{Colors.YELLOW}[礼物]{Colors.RESET} {Colors.MAGENTA}{nickname}{Colors.RESET} 送出 {Colors.BOLD}{gift_name} x {gfcnt}{Colors.RESET} (连击: {hits})")
        elif msg_type == 'uenter':
            nickname = msg.get('nn', 'Unknown')
            # print(f"[进入] {nickname} 进入了直播间")

    def on_error(self, ws, error):
        print(f"{Colors.RED}WebSocket Error: {error}{Colors.RESET}")

    def on_close(self, ws, close_status_code, close_msg):
        print(f"{Colors.YELLOW}Connection closed.{Colors.RESET}")

    def on_open(self, ws):
        print(f"{Colors.GREEN}Successfully connected to Douyu server! Joining room {self.room_id}...{Colors.RESET}")
        # Login
        ws.send(self.encode_packet(689, f"type@=loginreq/roomid@={self.room_id}/"), opcode=websocket.ABNF.OPCODE_BINARY)
        # Join group
        ws.send(self.encode_packet(689, f"type@=joingroup/rid@={self.room_id}/gid@=-9999/"), opcode=websocket.ABNF.OPCODE_BINARY)
        
        # Keepalive heartbeat
        def heartbeat():
            while True:
                time.sleep(45)
                try:
                    ws.send(self.encode_packet(689, "type@=mrkl/"), opcode=websocket.ABNF.OPCODE_BINARY)
                except Exception:
                    break
        
        threading.Thread(target=heartbeat, daemon=True).start()

    def start(self):
        header = [
            "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin: https://www.douyu.com"
        ]
        
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        context.set_ciphers('DEFAULT')
        
        self.ws = websocket.WebSocketApp(
            self.url,
            header=header,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        
        print(f"Connecting to room {self.room_id}...")
        self.ws.run_forever(sslopt={"context": context})

if __name__ == '__main__':
    room = "9999"
    if len(sys.argv) > 1:
        room = sys.argv[1]
    client = DouyuDanmakuClient(room)
    try:
        client.start()
    except KeyboardInterrupt:
        print("\nExiting...")