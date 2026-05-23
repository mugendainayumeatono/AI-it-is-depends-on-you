import asyncio
import websockets
import json
import argparse
import time

class ChromeExtensionBridge:
    def __init__(self):
        self.ws = None
        self.req_id = 0
        self.pending_requests = {}
        self.connected_event = asyncio.Event()
    
    async def handler(self, websocket):
        self.ws = websocket
        self.connected_event.set()
        print("[Python Server] Chrome Extension connected!")
        try:
            async for message in websocket:
                data = json.loads(message)
                if 'id' in data:
                    req_id = data['id']
                    if req_id in self.pending_requests:
                        self.pending_requests[req_id].set_result(data)
                elif 'event' in data:
                    # Could log CDP events here if needed
                    pass
        except websockets.exceptions.ConnectionClosed:
            print("[Python Server] Chrome Extension disconnected.")
        finally:
            self.ws = None
            self.connected_event.clear()

    async def _send_request(self, payload):
        if not self.ws:
            raise Exception("WebSocket is not connected")
        self.req_id += 1
        payload['id'] = self.req_id
        future = asyncio.get_event_loop().create_future()
        self.pending_requests[self.req_id] = future
        await self.ws.send(json.dumps(payload))
        try:
            response = await asyncio.wait_for(future, timeout=10.0)
        except asyncio.TimeoutError:
            del self.pending_requests[self.req_id]
            raise Exception(f"Request timeout for {payload.get('action')}")
            
        del self.pending_requests[self.req_id]
        if 'error' in response:
            raise Exception(f"Extension Error: {response['error']}")
        return response.get('result')

    async def query_tabs(self, match_url):
        return await self._send_request({"action": "queryTabs", "params": {"url": match_url}})

    async def attach(self, tab_id):
        return await self._send_request({"action": "attach", "tabId": tab_id})

    async def detach(self, tab_id):
        return await self._send_request({"action": "detach", "tabId": tab_id})

    async def send_command(self, tab_id, method, params=None):
        return await self._send_request({"action": "sendCommand", "tabId": tab_id, "method": method, "params": params or {}})


async def send_danmu(port, room_id, text, keep_alive):
    bridge = ChromeExtensionBridge()
    server = await websockets.serve(bridge.handler, "127.0.0.1", port)
    print(f"[Python Server] Listening on ws://127.0.0.1:{port}")
    print("[Python Server] Waiting for Chrome Extension to connect...")
    
    # Wait for extension to connect
    await bridge.connected_event.wait()
    
    print(f"[Action] Searching for Douyu room {room_id}...")
    # Find the Douyu tab
    tabs = await bridge.query_tabs(f"*://www.douyu.com/{room_id}*")
    if not tabs:
        print(f"[Error] Could not find any opened tab for douyu.com/{room_id}.")
        print("[Tip] Please open the room in Chrome first!")
        server.close()
        return
        
    tab_id = tabs[0]['id']
    print(f"[Action] Found tab ID: {tab_id}, attaching debugger...")
    
    await bridge.attach(tab_id)
    
    try:
        print("[Action] Looking for chat input box...")
        
        # 1. Evaluate JS to find the chatbox and get its coordinates
        js_code = """
        (function() {
            var input = document.querySelector('.ChatSend-txt');
            if (!input) input = document.querySelector('[class*="ChatSend"] textarea');
            if (!input) input = document.querySelector('[class*="ChatSend"] input');
            if (!input) return null;
            
            // Optional: check if we have a send button before returning success
            var btn = document.querySelector('.ChatSend-button');
            if (!btn) {
                var all = document.querySelectorAll('[class*="ChatSend"] button, [class*="ChatSend"] div');
                for (var b of all) {
                    if (b.innerText && b.innerText.trim() === '发送') { btn = b; break; }
                }
            }
            if (!btn) return null; // No send button found
            
            var rect = input.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };
        })();
        """
        eval_res = await bridge.send_command(tab_id, "Runtime.evaluate", {"expression": js_code, "returnByValue": True})
        if not eval_res or 'result' not in eval_res or eval_res['result'].get('type') == 'null':
            print("[Error] Chat input box not found. Make sure the page is fully loaded and you are logged in.")
            return

        coords = eval_res['result']['value']
        x, y = coords['x'], coords['y']
        
        # 2. Click the chatbox
        print("[Action] Clicking chat input box...")
        await bridge.send_command(tab_id, "Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
        await asyncio.sleep(0.1)
        await bridge.send_command(tab_id, "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
        await asyncio.sleep(0.5)

        # 3. Enter text
        print(f"[Action] Typing text: {text}")
        for char in text:
            await bridge.send_command(tab_id, "Input.insertText", {"text": char})
            await asyncio.sleep(0.05)
            
        await asyncio.sleep(0.5)

        # 4. Press Enter
        print("[Action] Pressing Enter to send...")
        await bridge.send_command(tab_id, "Input.dispatchKeyEvent", {"type": "keyDown", "windowsVirtualKeyCode": 13, "unmodifiedText": "\\r", "text": "\\r"})
        await asyncio.sleep(0.1)
        await bridge.send_command(tab_id, "Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 13})
        
        print("[Success] Danmu sent!")
        
    except Exception as e:
        print(f"[Error] Failed to send danmu: {e}")
    finally:
        if not keep_alive:
            print("[Action] Detaching debugger...")
            await bridge.detach(tab_id)
            server.close()
            await server.wait_closed()
        else:
            print("[Action] Keeping connection alive. Press Ctrl+C to exit.")
            await asyncio.Future()  # run forever

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Douyu Danmu Sender via Chrome Extension Bridge")
    parser.add_argument("room_id", type=str, help="Douyu Room ID (e.g., 9046690)")
    parser.add_argument("text", type=str, help="Danmu text to send")
    parser.add_argument("--port", type=int, default=9222, help="WebSocket server port (default 9222)")
    parser.add_argument("--keep-alive", action="store_true", help="Keep debugger attached after sending")
    
    args = parser.parse_args()
    
    try:
        asyncio.run(send_danmu(args.port, args.room_id, args.text, args.keep_alive))
    except KeyboardInterrupt:
        print("\nExiting...")
