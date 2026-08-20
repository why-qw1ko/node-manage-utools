import { createApp } from 'vue';
import './main.css';
import App from './App.vue';

// 全局错误捕获，避免错误内容通过 innerHTML 注入页面
function renderFatalError(message) {
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:red;padding:20px;white-space:pre-wrap;';
  pre.textContent = message;
  document.body.replaceChildren(pre);
}

window.onerror = function(msg, url, line, col, error) {
  renderFatalError(`Error: ${msg}\nLine: ${line}\n${error?.stack || ''}`);
};
window.addEventListener('unhandledrejection', function(e) {
  renderFatalError(`Unhandled Promise: ${e.reason?.stack || e.reason || '未知错误'}`);
});

createApp(App).mount('#app');
