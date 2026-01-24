// Douyu Danmu Sender 内容脚本
// 这个脚本负责向斗鱼直播间的弹幕输入框发送消息并点击发送按钮。

console.log('斗鱼弹幕发送插件内容脚本已加载');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendMessage') {
    // 使用预定义的选择器查找输入框和发送按钮
    const chatInput = document.querySelector(config.danmuInputSelector);
    console.log('查找弹幕输入框 (' + config.danmuInputSelector + '):', chatInput);
    const sendButton = document.querySelector(config.danmuSendButtonSelector);
    console.log('查找发送按钮 (' + config.danmuSendButtonSelector + '):', sendButton);

    if (chatInput && sendButton) {
      // 1. 设置内容
      chatInput.textContent = request.message;

      // 2. 模拟用户输入事件序列
      const focusEvent = new Event('focus', { bubbles: true });
      chatInput.dispatchEvent(focusEvent);

      const inputEvent = new Event('input', { bubbles: true });
      chatInput.dispatchEvent(inputEvent);

      const blurEvent = new Event('blur', { bubbles: true });
      chatInput.dispatchEvent(blurEvent);

      // 3. 点击发送按钮
      sendButton.click();
      sendResponse({status: "success"});
    } else {
      console.error('斗鱼弹幕发送插件: 未找到弹幕输入框或发送按钮。');
      sendResponse({status: "error", message: "未找到弹幕输入框或发送按钮"});
    }
  }
  return true; // 保持消息通道开启以进行异步响应
});
