'use strict';

// Progress UI for the assisted update download.
//
// The page is deliberately self-contained: no remote content, no nodeIntegration
// and no preload. The only channel back to the shell is a custom URL that
// main.js intercepts via will-navigate, so a compromised page could at worst
// ask to cancel a download.
//
// The HTML builder and the progress formatting are pure functions so they can be
// unit-tested without Electron; main.js owns the BrowserWindow itself.

const CANCEL_URL = 'dsh-desktop:cancel';

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const total = Math.max(Math.round(seconds), 0);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分 ${total % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

// Turns raw byte counters into what the window shows. Kept separate from the
// DOM so the arithmetic (percent clamping, ETA, speed) is testable.
function formatProgress({ received = 0, total = 0, startedAt, now = Date.now() } = {}) {
  const safeReceived = Number.isFinite(received) && received > 0 ? received : 0;
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const percent = safeTotal > 0 ? Math.max(0, Math.min(100, Math.floor((safeReceived / safeTotal) * 100))) : 0;

  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  const speed = elapsed >= 0.5 ? safeReceived / elapsed : 0;

  const parts = [`${formatBytes(safeReceived)} / ${safeTotal > 0 ? formatBytes(safeTotal) : '未知大小'}`];
  if (speed > 0) parts.push(`${formatBytes(speed)}/s`);
  let etaSeconds = null;
  if (speed > 0 && safeTotal > safeReceived) {
    etaSeconds = (safeTotal - safeReceived) / speed;
    parts.push(`约剩 ${formatDuration(etaSeconds)}`);
  }
  return { percent, detail: parts.join(' · '), etaSeconds };
}

function buildProgressHtml({ version } = {}) {
  const label = escapeHtml(version);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>正在下载更新</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 13px -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
         background: #f6f6f8; color: #1d1d1f; -webkit-user-select: none; }
  .wrap { padding: 20px 22px; }
  .title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .sub { font-size: 12px; margin-bottom: 14px; }
  .muted { color: #6e6e73; }
  .track { height: 8px; border-radius: 4px; background: #dcdce0; overflow: hidden; }
  .bar { height: 100%; width: 0%; background: #0a84ff; border-radius: 4px; transition: width .25s ease; }
  .meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; }
  .actions { margin-top: 16px; text-align: right; }
  button { font: inherit; padding: 5px 16px; border-radius: 6px; border: 1px solid #c9c9ce;
           background: #fff; color: inherit; cursor: pointer; }
  button:hover { filter: brightness(0.97); }
  /* Dark overrides MUST come last: they share specificity with the base rules
     above, so declaring them earlier silently loses to the light values. */
  @media (prefers-color-scheme: dark) {
    body { background: #202022; color: #f2f2f4; }
    .muted { color: #98989d; }
    .track { background: #3a3a3c; }
    button { background: #2c2c2e; color: #f2f2f4; border-color: #48484a; }
  }
</style></head>
<body><div class="wrap">
  <div class="title" id="phase">正在下载更新…</div>
  <div class="sub muted" id="version">${label ? `版本 ${label}` : ''}</div>
  <div class="track"><div class="bar" id="bar"></div></div>
  <div class="meta"><span class="muted" id="detail">正在连接…</span><span class="muted" id="percent">0%</span></div>
  <div class="actions"><button id="cancel" type="button">取消下载</button></div>
</div>
<script>
  window.__setProgress = function (data) {
    if (!data) return;
    if (data.phase) document.getElementById('phase').textContent = data.phase;
    if (typeof data.percent === 'number') {
      document.getElementById('bar').style.width = data.percent + '%';
      document.getElementById('percent').textContent = data.percent + '%';
    }
    if (data.detail) document.getElementById('detail').textContent = data.detail;
  };
  document.getElementById('cancel').addEventListener('click', function () {
    document.getElementById('phase').textContent = '正在取消…';
    document.getElementById('cancel').disabled = true;
    window.location.href = ${JSON.stringify(CANCEL_URL)};
  });
</script>
</body></html>`;
}

module.exports = { CANCEL_URL, escapeHtml, formatBytes, formatDuration, formatProgress, buildProgressHtml };
