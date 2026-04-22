const { chrome } = require('jest-chrome');

// Ensure addListener is a mock
if (!chrome.runtime.onMessage.addListener.mock) {
    chrome.runtime.onMessage.addListener = jest.fn();
}
if (!chrome.runtime.onInstalled.addListener.mock) {
    chrome.runtime.onInstalled.addListener = jest.fn();
}
if (!chrome.contextMenus.onClicked.addListener.mock) {
    chrome.contextMenus.onClicked.addListener = jest.fn();
}

// Mock getContexts
if (!chrome.runtime.getContexts) {
    chrome.runtime.getContexts = jest.fn().mockResolvedValue([]);
}

// Mock offscreen
if (!chrome.offscreen) {
    chrome.offscreen = {
        createDocument: jest.fn().mockResolvedValue(true)
    };
}

global.chrome = chrome;
