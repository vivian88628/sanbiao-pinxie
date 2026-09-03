// 三表听写 PWA Service Worker
// 策略：缓存优先（先给本地缓存，秒开） + 后台静默更新（下次打开生效）
// 目的：解决 github.io 境外访问慢 —— 只要成功打开过一次，之后断网 / 慢网都能瞬间打开。
// 注意：每次发布新版本请修改 CACHE 版本号，旧缓存会在 activate 时自动清理。

const CACHE = 'dict-pwa-v1';
const SHELL = 'index.html';
const FILES = ['./', SHELL, 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // 单个文件失败不影响整体安装（如图标缺失），保证 SW 一定能装上
      .then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 健康校验：云端偶发返回「200 + 0 字节」的空响应，绝不能写进缓存，否则会把坏文件固化
function isHealthy(resp) {
  if (!resp || !resp.ok || resp.status !== 200) return false;
  const len = resp.headers.get('content-length');
  if (len !== null && Number(len) === 0) return false;
  return true;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  e.respondWith(
    caches.match(req).then(hit => {
      // 后台静默更新：成功且健康才写入缓存；失败/不健康一律忽略，不影响本次打开
      const update = fetch(req)
        .then(resp => {
          if (isHealthy(resp)) {
            const cp = resp.clone();
            caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
          }
          return resp;
        })
        .catch(() => null);

      if (hit) return hit; // 有缓存立刻返回，不等网络 —— 这是「秒开」的关键

      // 没缓存（首次打开）：等网络；失败了再退回首页缓存
      return update.then(r => {
        if (r) return r;
        if (req.mode === 'navigate') {
          return caches.match(SHELL).then(sh => sh || Response.error());
        }
        return Response.error();
      });
    })
  );
});
