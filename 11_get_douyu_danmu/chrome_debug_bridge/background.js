let ws = null;
const WS_URL = "ws://127.0.0.1:9222";
let isConnecting = false;
let attachedTabs = new Set();

function connectWebSocket() {
    if (ws || isConnecting) return;
    isConnecting = true;
    
    console.log(`[Bridge] Attempting to connect to ${WS_URL}...`);
    try {
        ws = new WebSocket(WS_URL);
    } catch (e) {
        console.error("[Bridge] WebSocket creation failed", e);
        isConnecting = false;
        setTimeout(connectWebSocket, 3000);
        return;
    }

    ws.onopen = () => {
        console.log("[Bridge] Connected to Python server!");
        isConnecting = false;
        ws.send(JSON.stringify({ event: "connected" }));
    };

    ws.onclose = () => {
        console.log("[Bridge] Disconnected from Python server, retrying in 3s...");
        ws = null;
        isConnecting = false;
        // Detach all tabs upon Python server disconnect to prevent memory leaks and clear yellow banner
        for (let tabId of attachedTabs) {
            try { chrome.debugger.detach({ tabId }); } catch(e) { console.error("Detach failed on close", e); }
        }
        attachedTabs.clear();
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
        console.error("[Bridge] WebSocket error", err);
        // Will trigger onclose
    };

    ws.onmessage = async (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            console.error("[Bridge] Failed to parse message", event.data);
            return;
        }

        const { id, action, tabId, method, params } = msg;

        try {
            if (action === "queryTabs") {
                const tabs = await chrome.tabs.query(params || {});
                ws.send(JSON.stringify({ id, result: tabs }));
            } 
            else if (action === "attach") {
                await chrome.debugger.attach({ tabId }, "1.3");
                attachedTabs.add(tabId);
                ws.send(JSON.stringify({ id, result: "attached" }));
            }
            else if (action === "detach") {
                await chrome.debugger.detach({ tabId });
                attachedTabs.delete(tabId);
                ws.send(JSON.stringify({ id, result: "detached" }));
            }
            else if (action === "sendCommand") {
                // In Manifest V3, sendCommand returns a promise and throws on error
                const result = await chrome.debugger.sendCommand({ tabId }, method, params);
                ws.send(JSON.stringify({ id, result: result || {} }));
            }
            else {
                ws.send(JSON.stringify({ id, error: `Unknown action: ${action}` }));
            }
        } catch (err) {
            console.error(`[Bridge] Error executing ${action}:`, err);
            ws.send(JSON.stringify({ id, error: err.message || err.toString() }));
        }
    };
}

// Forward CDP events to Python
chrome.debugger.onEvent.addListener((source, method, params) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            event: "cdpEvent",
            tabId: source.tabId,
            method: method,
            params: params
        }));
    }
});

// Handle tab detach from external sources (e.g. user closes yellow banner or tab)
chrome.debugger.onDetach.addListener((source, reason) => {
    attachedTabs.delete(source.tabId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            event: "detached",
            tabId: source.tabId,
            reason: reason
        }));
    }
});

// Start connecting loop
connectWebSocket();

// Ensure Service Worker stays alive or wakes up to reconnect
chrome.alarms.create("keepAlive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keepAlive") {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            connectWebSocket();
        }
    }
});
