// 카드 데이터나 화면을 고치면 아래 버전 숫자를 올려 주세요.
const CACHE = "engcards-v3";
const META = "engcards-meta";
const ASSETS = ["./", "./index.html", "./app.js", "./data.js", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== META).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 안드로이드 크롬(설치한 앱)에서 주기적으로 깨어나, 알림 시간이 지났는데 오늘 공부를 안 했으면 알림
self.addEventListener("periodicsync", e => {
  if (e.tag === "daily-reminder") e.waitUntil(remind());
});
async function remind() {
  const cache = await caches.open(META);
  const hit = await cache.match("./__meta");
  if (!hit) return;
  const m = await hit.json();
  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  if (m.last === today || m.notified === today) return;
  const [h, mi] = (m.remind || "08:00").split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + mi) return;
  m.notified = today;
  await cache.put("./__meta", new Response(JSON.stringify(m)));
  await self.registration.showNotification("오늘의 영어", {
    body: "오늘의 표현과 단어가 기다리고 있어요",
    icon: "icon-192.png", badge: "icon-192.png", tag: "daily"
  });
}
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(ws => ws.length ? ws[0].focus() : self.clients.openWindow("./")));
});

// 저장된 파일을 먼저 보여 주고, 인터넷이 되면 뒤에서 새 파일로 갱신
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request, { ignoreSearch: true }).then(hit => {
        const net = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    )
  );
});
