(() => {
"use strict";

const CATS = {
  small:   { name: "스몰토크" },
  daily:   { name: "생활 회화" },
  biz:     { name: "비즈니스" },
  grammar: { name: "문법" },
  word:    { name: "단어" }
};
const EXPR_ORDER = ["small", "daily", "biz", "grammar"]; // 표현은 이 순서로 돌아가며 나옴
const KEY = "engcards.v1";
const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));

// ───────── 저장 ─────────
function defaults() {
  return { history: {}, rounds: {}, ptr: 0, marks: {}, chats: {}, settings: { expr: 2, word: 1, rate: 0.9, autoSpeak: false } };
}
function load() {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
  } catch (e) { return d; }
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast("저장 공간에 쓸 수 없어요"); }
}

// ───────── 날짜 ─────────
// ?date=2026-12-01 로 날짜를 바꿔 테스트할 수 있습니다.
function todayStr() {
  const q = new URLSearchParams(location.search).get("date");
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function niceDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return m + "월 " + d + "일 (" + WEEK[dt.getDay()] + ")";
}

// ───────── 오늘 카드 뽑기 (중복 방지) ─────────
function pick(cat, exclude) {
  const pool = CARDS.filter(c => c.c === cat).map(c => c.id);
  if (!pool.length) return null;
  const r = state.rounds[cat] || (state.rounds[cat] = { n: 1, used: [] });
  r.used = r.used.filter(id => BY_ID[id]); // 지워진 카드 정리
  let avail = pool.filter(id => !r.used.includes(id) && !exclude.includes(id));
  if (!avail.length) {           // 이 주제를 한 바퀴 다 봄 → 다음 회차
    r.n += 1;
    r.used = [];
    avail = pool.filter(id => !exclude.includes(id));
    if (!avail.length) return null;
  }
  const id = avail[Math.floor(Math.random() * avail.length)];
  r.used.push(id);
  return id;
}
function ensureToday() {
  const d = todayStr();
  if (state.history[d]) return state.history[d];
  const ids = [];
  for (let i = 0; i < state.settings.expr; i++) {
    const cat = EXPR_ORDER[state.ptr % EXPR_ORDER.length];
    state.ptr += 1;
    const id = pick(cat, ids);
    if (id) ids.push(id);
  }
  for (let i = 0; i < state.settings.word; i++) {
    const id = pick("word", ids);
    if (id) ids.push(id);
  }
  state.history[d] = ids;
  save();
  return ids;
}

// 서비스워커(백그라운드 알림)가 읽을 수 있게 마지막 학습일과 알림 시간을 남김
function writeMeta() {
  if (!("caches" in window)) return;
  const meta = { last: todayStr(), remind: state.settings.remind || "08:00" };
  caches.open("engcards-meta").then(c => c.put("./__meta", new Response(JSON.stringify(meta)))).catch(() => {});
}

// ───────── 받은 카드 모음 ─────────
function received() {
  // id → { card, dates[] } (최근 날짜 먼저)
  const map = new Map();
  Object.keys(state.history).sort().reverse().forEach(d => {
    state.history[d].forEach(id => {
      const card = BY_ID[id];
      if (!card) return;
      if (!map.has(id)) map.set(id, { card, dates: [] });
      map.get(id).dates.push(d);
    });
  });
  return map;
}

// ───────── 화면 유틸 ─────────
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICON = {
  speak: '<svg class="i" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  star:  '<svg class="i" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  starOn:'<svg class="i" viewBox="0 0 24 24" style="fill:currentColor"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  chat:  '<svg class="i" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  mic:   '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  send:  '<svg class="i" viewBox="0 0 24 24"><path d="M4 12 20 4l-6 16-3-7z"/></svg>'
};
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}
const mark = id => state.marks[id] || {};

function actionsHtml(c) {
  const m = mark(c.id);
  return '<div class="actions">' +
    '<button type="button" class="btn" data-act="speak" data-id="' + c.id + '" data-which="en">' + ICON.speak + "듣기</button>" +
    '<button type="button" class="btn ' + (m.star ? "on-star" : "") + '" data-act="star" data-id="' + c.id + '">' + (m.star ? ICON.starOn : ICON.star) + "즐겨찾기</button>" +
    '<button type="button" class="btn ' + (m.known ? "on-known" : "") + '" data-act="known" data-id="' + c.id + '">' + ICON.check + (m.known ? "외웠어요" : "외웠어요?") + "</button>" +
    '<button type="button" class="btn" data-act="chat" data-id="' + c.id + '">' + ICON.chat + "대화 연습</button>" +
    "</div>";
}
function exHtml(c) {
  return '<div class="ex"><div><p class="ex-en">' + esc(c.ex) + '</p><p class="ex-ko">' + esc(c.exKo) + "</p></div>" +
    '<button type="button" class="icon-btn" aria-label="예문 듣기" data-act="speak" data-id="' + c.id + '" data-which="ex">' + ICON.speak + "</button></div>";
}

// ───────── 오늘 탭 ─────────
function renderToday() {
  const ids = ensureToday();
  writeMeta();
  const days = Object.keys(state.history).length;
  $("#title").textContent = "오늘의 영어";
  $("#subtitle").textContent = niceDate(todayStr()) + " · " + days + "일째 학습 중";
  const exprN = ids.filter(id => BY_ID[id] && BY_ID[id].c !== "word").length;
  const wordN = ids.length - exprN;
  let h = '<p class="meta" style="margin:4px 2px 12px">오늘은 표현 ' + exprN + "개, 단어 " + wordN + "개예요</p>";
  ids.forEach(id => {
    const c = BY_ID[id]; if (!c) return;
    const round = (state.rounds[c.c] || {}).n || 1;
    h += '<article class="card">' +
      '<div class="card-top"><span class="badge b-' + c.c + '">' + CATS[c.c].name + "</span>" +
      (round > 1 ? '<span class="meta">' + round + "회차 복습</span>" : "") + "</div>" +
      '<h2 class="en">' + esc(c.en) + (c.pos ? '<span class="pos">' + esc(c.pos) + "</span>" : "") + "</h2>" +
      '<p class="ko">' + esc(c.ko) + "</p>" +
      exHtml(c) +
      (c.tip ? '<p class="tip"><b>Tip</b> ' + esc(c.tip) + "</p>" : "") +
      actionsHtml(c) + "</article>";
  });
  const allKnown = ids.length && ids.every(id => mark(id).known);
  h += '<p class="done-box">' + (allKnown ? "오늘 카드를 모두 외웠어요. 내일 또 만나요!" : "지난 카드는 아래 기록 탭에서 다시 볼 수 있어요.") + "</p>";
  $("#view-today").innerHTML = h;
}

// ───────── 기록 탭 ─────────
const arch = { mode: "date", filter: "all", q: "" };
const FILTERS = [["all", "전체"], ["small", "스몰토크"], ["daily", "생활 회화"], ["biz", "비즈니스"], ["grammar", "문법"], ["word", "단어"], ["star", "즐겨찾기"], ["todo", "아직 못 외움"], ["known", "외운 것"]];

function matches(c) {
  const f = arch.filter, m = mark(c.id);
  if (f === "star" && !m.star) return false;
  if (f === "known" && !m.known) return false;
  if (f === "todo" && m.known) return false;
  if (CATS[f] && c.c !== f) return false;
  if (arch.q) {
    const q = arch.q.toLowerCase();
    if (![c.en, c.ko, c.ex, c.exKo, c.tip].some(t => t && t.toLowerCase().includes(q))) return false;
  }
  return true;
}
function itemHtml(c, extra) {
  const m = mark(c.id);
  return '<div class="item" data-item="' + c.id + '">' +
    '<div class="item-click" data-act="toggle">' +
    '<div class="item-head"><span class="badge b-' + c.c + '">' + CATS[c.c].name + "</span>" +
    '<span class="meta">' + (m.star ? '<span style="color:var(--star)">★</span> ' : "") + (m.known ? '<span style="color:var(--ok)">외움</span> ' : "") + (extra || "") + "</span></div>" +
    '<div class="item-en">' + esc(c.en) + (c.pos ? '<span class="pos">' + esc(c.pos) + "</span>" : "") + "</div>" +
    '<div class="item-ko">' + esc(c.ko) + "</div></div>" +
    '<div class="more">' + exHtml(c) + (c.tip ? '<p class="tip"><b>Tip</b> ' + esc(c.tip) + "</p>" : "") + actionsHtml(c) + "</div>" +
    "</div>";
}
function renderArchive() {
  $("#title").textContent = "지난 카드";
  const rec = received();
  $("#subtitle").textContent = "지금까지 " + rec.size + "개 카드를 받았어요";
  $("#chips").innerHTML = FILTERS.map(([k, n]) => '<button type="button" class="chip" data-filter="' + k + '" aria-pressed="' + (arch.filter === k) + '">' + n + "</button>").join("");
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === arch.mode)));
  const list = $("#arch-list");
  let h = "", n = 0;
  if (arch.mode === "date") {
    Object.keys(state.history).sort().reverse().forEach(d => {
      const cards = state.history[d].map(id => BY_ID[id]).filter(c => c && matches(c));
      if (!cards.length) return;
      n += cards.length;
      h += '<div class="day">' + niceDate(d) + (d === todayStr() ? " · 오늘" : "") + "</div>" + cards.map(c => itemHtml(c)).join("");
    });
  } else {
    const groups = {};
    rec.forEach(({ card, dates }) => { if (matches(card)) (groups[card.c] = groups[card.c] || []).push({ card, dates }); });
    Object.keys(CATS).forEach(k => {
      const g = groups[k]; if (!g) return;
      n += g.length;
      const total = CARDS.filter(c => c.c === k).length;
      h += '<div class="day">' + CATS[k].name + " · " + g.length + " / " + total + "</div>" +
        g.map(({ card, dates }) => itemHtml(card, niceDate(dates[0]).replace(/ \(.\)/, "") + (dates.length > 1 ? " · " + dates.length + "번 받음" : ""))).join("");
    });
  }
  $("#arch-count").textContent = n + "개";
  list.innerHTML = h || '<div class="empty">' + (rec.size ? "조건에 맞는 카드가 없어요.<br>검색어나 분류를 바꿔 보세요." : "아직 받은 카드가 없어요.<br>오늘 탭에서 첫 카드를 받아 보세요.") + "</div>";
}

// ───────── 설정 탭 ─────────
function renderSettings() {
  $("#title").textContent = "설정";
  $("#subtitle").textContent = "카드 수, 진도, 백업";
  const s = state.settings;
  const opt = (v, cur) => '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + v + "개</option>";
  let prog = "";
  Object.keys(CATS).forEach(k => {
    const total = CARDS.filter(c => c.c === k).length;
    const r = state.rounds[k] || { n: 1, used: [] };
    const used = r.used.length;
    prog += '<div class="prog"><div class="prog-top"><span>' + CATS[k].name + "</span><span>" + r.n + "회차 · " + used + " / " + total + "</span></div>" +
      '<div class="bar"><i style="width:' + Math.round(used / total * 100) + '%"></i></div></div>';
  });
  $("#view-settings").innerHTML =
    '<div class="set">' +
    '<div class="set-row"><div>하루 표현 개수<small>스몰토크 → 생활 회화 → 비즈니스 → 문법 순서로 나와요</small></div><select id="s-expr">' + [0, 1, 2, 3].map(v => opt(v, s.expr)).join("") + "</select></div>" +
    '<div class="set-row"><div>하루 단어 개수</div><select id="s-word">' + [0, 1, 2, 3].map(v => opt(v, s.word)).join("") + "</select></div>" +
    '<div class="set-row"><div>발음 속도</div><select id="s-rate">' +
      [[0.7, "느리게"], [0.9, "보통"], [1.1, "빠르게"]].map(([v, n]) => '<option value="' + v + '"' + (v === s.rate ? " selected" : "") + ">" + n + "</option>").join("") + "</select></div>" +
    '</div><p class="meta" style="margin:-6px 4px 0">개수를 바꾸면 내일 카드부터 적용돼요.</p>' +
    '<h2 class="sec">주제별 진도</h2><div class="set">' + prog + "</div>" +
    '<p class="meta" style="margin:-6px 4px 0">한 주제를 다 보면 그 주제만 다음 회차로 다시 시작해요. 회차 안에서는 같은 카드가 나오지 않아요.</p>' +
    '<h2 class="sec">매일 알림</h2><div class="set">' +
    '<div class="set-row"><div>알림 시간<small>폰 캘린더에 매일 반복 알림을 추가해요</small></div><input type="time" id="s-time" value="' + (s.remind || "08:00") + '" style="padding:8px;border-radius:10px;border:1px solid var(--border);background:var(--surface2)"></div>' +
    '<div class="set-row"><div>캘린더에 알림 추가<small>받은 파일을 열고 캘린더에 추가를 눌러 주세요. 아이폰, 안드로이드 모두 돼요</small></div><button type="button" class="btn" id="b-ics">추가하기</button></div>' +
    '<div class="set-row"><div>앱 알림 켜기<small>안드로이드 크롬에서 홈 화면에 설치한 경우, 알림 시간이 지나도 공부를 안 했으면 알려 줘요</small></div><button type="button" class="btn" id="b-notify">켜기</button></div>' +
    "</div>" +
    '<h2 class="sec">AI 대화 연습</h2><div class="set">' +
    '<div class="set-row" style="display:block"><div>Claude API 키<small>console.anthropic.com에서 직접 발급한 키를 넣어 주세요. 이 기기에만 저장되고 백업 파일에는 들어가지 않아요. 대화할 때마다 요금이 들어요.</small></div>' +
    '<input type="password" id="s-key" class="keyinput" placeholder="sk-ant-..." autocomplete="off" value="' + esc(s.apiKey || "") + '"></div>' +
    '<div class="set-row"><div>대화 모델<small>Opus가 가장 똑똑하고, Haiku가 가장 저렴해요</small></div><select id="s-model">' +
      [["claude-opus-5-5", "Opus 5.5"], ["claude-sonnet-5-5", "Sonnet 5.5"], ["claude-haiku-5-5", "Haiku 5.5"]].map(([v, n]) => '<option value="' + v + '"' + (v === (s.model || "claude-opus-5-5") ? " selected" : "") + ">" + n + "</option>").join("") + "</select></div>" +
    '<div class="set-row"><div>AI 답 소리 내어 읽기</div><select id="s-auto"><option value="0"' + (s.autoSpeak ? "" : " selected") + '>끄기</option><option value="1"' + (s.autoSpeak ? " selected" : "") + ">켜기</option></select></div>" +
    "</div>" +
    '<h2 class="sec">백업</h2><div class="set">' +
    '<div class="set-row"><div>기록 내보내기<small>파일로 저장해 두면 폰을 바꿔도 이어서 할 수 있어요</small></div><button type="button" class="btn" id="b-export">내보내기</button></div>' +
    '<div class="set-row"><div>기록 가져오기</div><label class="btn" style="cursor:pointer">가져오기<input type="file" id="b-import" accept="application/json,.json" hidden></label></div>' +
    '<div class="set-row"><div class="danger">모든 기록 지우기</div><button type="button" class="btn danger" id="b-reset">지우기</button></div>' +
    "</div>" +
    '<p class="meta" style="margin:8px 4px 24px">카드 ' + CARDS.length + "개 수록 · 기록은 이 기기의 브라우저에만 저장돼요.</p>";

  $("#s-expr").onchange = e => { s.expr = +e.target.value; save(); toast("내일부터 표현 " + s.expr + "개"); };
  $("#s-word").onchange = e => { s.word = +e.target.value; save(); toast("내일부터 단어 " + s.word + "개"); };
  $("#s-rate").onchange = e => { s.rate = +e.target.value; save(); };
  $("#s-time").onchange = e => { s.remind = e.target.value; save(); writeMeta(); };
  $("#s-key").onchange = e => { s.apiKey = e.target.value.trim(); save(); toast(s.apiKey ? "API 키를 저장했어요" : "API 키를 지웠어요"); };
  $("#s-model").onchange = e => { s.model = e.target.value; save(); };
  $("#s-auto").onchange = e => { s.autoSpeak = e.target.value === "1"; save(); };
  $("#b-notify").onclick = async () => {
    if (!("Notification" in window)) { toast("이 브라우저는 알림을 지원하지 않아요"); return; }
    const p = await Notification.requestPermission();
    if (p !== "granted") { toast("알림이 허용되지 않았어요"); return; }
    writeMeta();
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.ready : null;
    if (reg && "periodicSync" in reg) {
      try {
        await reg.periodicSync.register("daily-reminder", { minInterval: 12 * 60 * 60 * 1000 });
        toast("앱 알림을 켰어요");
      } catch (err) { toast("홈 화면에 설치한 뒤 다시 눌러 주세요"); }
    } else {
      toast("이 기기는 앱 알림이 안 돼요. 캘린더 알림을 써 주세요");
    }
  };
  $("#b-ics").onclick = () => {
    const t = (s.remind || "08:00").replace(":", "");
    const d = todayStr().replace(/-/g, "");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//english-cards//KO", "BEGIN:VEVENT",
      "UID:engcards-daily@local", "DTSTAMP:" + d + "T000000", "DTSTART:" + d + "T" + t + "00", "DURATION:PT10M",
      "RRULE:FREQ=DAILY", "SUMMARY:오늘의 영어 공부하기", "DESCRIPTION:오늘의 영어 앱을 열어 카드를 확인하세요",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:오늘의 영어 공부 시간이에요", "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "english-daily-reminder.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("#b-export").onclick = () => {
    const copy = { ...state, settings: { ...state.settings } };
    delete copy.settings.apiKey; // 키는 백업에 넣지 않음
    const blob = new Blob([JSON.stringify(copy, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "english-cards-backup-" + todayStr() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("#b-import").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      const s2 = JSON.parse(t);
      if (!s2 || typeof s2.history !== "object") throw new Error("형식");
      const d = defaults();
      const key = state.settings.apiKey;
      state = { ...d, ...s2, settings: { ...d.settings, ...(s2.settings || {}) } };
      if (key) state.settings.apiKey = key;
      save(); toast("기록을 가져왔어요"); renderSettings();
    }).catch(() => toast("백업 파일을 읽지 못했어요"));
  };
  $("#b-reset").onclick = () => {
    if (!confirm("받은 카드, 즐겨찾기, 진도가 모두 지워져요. 계속할까요?")) return;
    state = defaults(); save(); toast("모두 지웠어요"); renderSettings();
  };
}

// ───────── AI 대화 연습 ─────────
let chatId = null, chatBusy = false, chatErr = "", backTab = "today", sdk = null;
const START_MSG = "Let's start the role-play.";

function systemPrompt(c) {
  return [
    "You are a friendly English conversation partner for a Korean learner.",
    "Today's target " + (c.c === "word" ? "word" : c.c === "grammar" ? "grammar point" : "expression") + ': "' + c.en + '" (meaning in Korean: ' + c.ko + ").",
    'Example: "' + c.ex + '"',
    "Run a short, natural everyday role-play in which the learner has a good chance to use the target.",
    "Keep each English reply to 1-3 short, natural sentences, and end with a question or prompt the learner can answer, ideally using the target.",
    "Use simple, natural English that an intermediate learner can follow.",
    "Format every reply exactly like this, with the separator line on its own:",
    "<your English reply>",
    "---",
    "<feedback written in Korean>",
    "In the Korean feedback (1-3 short lines): if the learner's last message had mistakes or sounded unnatural, give the corrected sentence and a very short reason; say whether they used the target and whether it was natural; if they are doing well, say so briefly.",
    "For your very first reply there is no learner message yet, so the Korean feedback should be a one-line hint about the situation and how they could use the target.",
    "Do not use the --- line anywhere else."
  ].join("\n");
}
function splitReply(text) {
  const i = text.indexOf("\n---");
  if (i < 0) return { en: text.trim(), fb: "" };
  return { en: text.slice(0, i).trim(), fb: text.slice(i).replace(/^\s*---\s*/, "").trim() };
}
async function getSdk() {
  if (!sdk) sdk = (await import("https://esm.sh/@anthropic-ai/sdk")).default;
  return sdk;
}
async function askClaude(c, msgs) {
  const Anthropic = await getSdk();
  const s = state.settings;
  const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true });
  const model = s.model || "claude-opus-5-5";
  const params = {
    model,
    max_tokens: 16000,
    system: systemPrompt(c),
    output_config: { effort: "low" },
    messages: msgs.map(m => ({ role: m.role, content: m.role === "assistant" ? m.en + "\n---\n" + m.fb : m.text }))
  };
  // 안전 검사로 거절되면 다른 모델로 자동으로 이어서 답하게 함 (Haiku는 미지원)
  const res = model === "claude-haiku-5-5"
    ? await client.messages.create(params)
    : await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  if (res.stop_reason === "refusal") throw new Error("refusal");
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  if (!text.trim()) throw new Error("empty");
  return splitReply(text);
}
function errText(err) {
  const A = sdk;
  if (A && err instanceof A.AuthenticationError) return "API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요.";
  if (A && err instanceof A.PermissionDeniedError) return "이 키로는 이 모델을 쓸 수 없어요. 설정에서 다른 모델을 골라 보세요.";
  if (A && err instanceof A.RateLimitError) return "요청이 너무 많아요. 잠시 후 다시 보내 주세요.";
  if (A && err instanceof A.APIConnectionError) return "인터넷 연결을 확인해 주세요.";
  if (A && err instanceof A.APIError) return "Claude 서버 오류가 났어요. 잠시 후 다시 시도해 주세요.";
  if (err && err.message === "refusal") return "이 대화는 이어 갈 수 없어요. 처음부터 다시 시작해 보세요.";
  if (!navigator.onLine) return "인터넷 연결을 확인해 주세요.";
  return "답을 받지 못했어요. 다시 보내 주세요.";
}
function openChat(id) { if (tab !== "chat") backTab = tab; chatId = id; chatErr = ""; show("chat"); }
async function sendChat(text) {
  const c = BY_ID[chatId];
  if (!c || chatBusy) return;
  const msgs = state.chats[chatId] || (state.chats[chatId] = []);
  if (text != null) msgs.push({ role: "user", text });
  else if (!msgs.length) msgs.push({ role: "user", text: START_MSG, hidden: true });
  chatBusy = true; chatErr = ""; save(); renderChat();
  try {
    const r = await askClaude(c, msgs);
    msgs.push({ role: "assistant", en: r.en, fb: r.fb });
    save();
  } catch (err) {
    chatErr = errText(err);
  }
  chatBusy = false;
  if (tab === "chat" && BY_ID[chatId] === c) renderChat();
}
function renderChat() {
  const c = BY_ID[chatId];
  if (!c) { show("today"); return; }
  $("#title").textContent = "대화 연습";
  $("#subtitle").textContent = "오늘의 표현으로 Claude와 이야기해요";
  const msgs = state.chats[chatId] || [];
  const last = msgs[msgs.length - 1];
  let h = '<div class="target"><span class="badge b-' + c.c + '">' + CATS[c.c].name + "</span><b style=\"margin-top:6px\">" + esc(c.en) + "</b>" + esc(c.ko) + "</div>";
  if (!state.settings.apiKey) {
    h += '<div class="card"><p style="margin:0 0 12px;line-height:1.6">AI 대화를 쓰려면 설정에서 Claude API 키를 먼저 넣어 주세요.</p><button type="button" class="btn" data-tab="settings">설정으로 가기</button></div>';
    $("#view-chat").innerHTML = h + '<button type="button" class="btn" data-act="chatback">← 돌아가기</button>';
    return;
  }
  h += '<div class="msgs">';
  msgs.forEach((m, i) => {
    if (m.hidden) return;
    if (m.role === "user") h += '<div class="bub me">' + esc(m.text) + "</div>";
    else h += '<div class="bub ai"><div>' + esc(m.en) +
      ' <button type="button" class="icon-btn" aria-label="듣기" data-act="speakmsg" data-i="' + i + '">' + ICON.speak + "</button></div>" +
      (m.fb ? '<div class="fb">' + esc(m.fb) + "</div>" : "") + "</div>";
  });
  if (chatBusy) h += '<div class="typing">Claude가 답을 쓰는 중…</div>';
  h += "</div>";
  if (chatErr) h += '<div class="err">' + esc(chatErr) + ' <button type="button" class="btn" data-act="retry">다시 보내기</button></div>';
  const canType = !chatBusy && last && last.role === "assistant";
  h += '<div class="composer">' +
    '<textarea id="chat-in" rows="1" placeholder="영어로 답해 보세요" ' + (canType ? "" : "disabled") + "></textarea>" +
    (window.SpeechRecognition || window.webkitSpeechRecognition ? '<button type="button" class="btn" data-act="mic" aria-label="말로 입력" ' + (canType ? "" : "disabled") + ">" + ICON.mic + "</button>" : "") +
    '<button type="button" class="btn" data-act="send" aria-label="보내기" ' + (canType ? "" : "disabled") + ">" + ICON.send + "</button></div>" +
    '<div id="chat-in-err" class="err" hidden></div>' +
    '<div class="actions"><button type="button" class="btn" data-act="chatback">← 돌아가기</button>' +
    '<button type="button" class="btn" data-act="chatreset">처음부터 다시</button></div>';
  $("#view-chat").innerHTML = h;
  const ta = $("#chat-in");
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitChat(); } });
  ta.addEventListener("input", () => { $("#chat-in-err").hidden = true; });
  if (canType) ta.focus({ preventScroll: true });
  window.scrollTo(0, document.body.scrollHeight);
  if (!msgs.length && !chatBusy && !chatErr) sendChat(null);
  const a = msgs[msgs.length - 1];
  if (a && a.role === "assistant" && a.spoken !== true && state.settings.autoSpeak) { a.spoken = true; speak(a.en); }
}
function submitChat() {
  const ta = $("#chat-in");
  if (!ta) return;
  const v = ta.value.trim();
  if (!v) { const e = $("#chat-in-err"); e.textContent = "답을 먼저 입력해 주세요."; e.hidden = false; return; }
  sendChat(v);
}
function listen(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = "en-US"; r.interimResults = false;
  btn.disabled = true; toast("영어로 말해 보세요");
  r.onresult = e => { const ta = $("#chat-in"); if (ta) ta.value = (ta.value ? ta.value + " " : "") + e.results[0][0].transcript; };
  r.onerror = () => toast("음성을 알아듣지 못했어요");
  r.onend = () => { btn.disabled = false; };
  r.start();
}

// ───────── 탭 전환 ─────────
let tab = "today";
function show(t) {
  tab = t;
  ["today", "archive", "settings", "chat"].forEach(k => { $("#view-" + k).hidden = k !== t; });
  document.querySelectorAll("nav.tabs button").forEach(b => b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  window.scrollTo(0, 0);
  if (t === "today") renderToday();
  else if (t === "archive") renderArchive();
  else if (t === "chat") renderChat();
  else renderSettings();
}
function rerender() { if (tab === "today") renderToday(); else if (tab === "archive") renderArchive(); }

// ───────── 발음 ─────────
function speak(text) {
  if (!("speechSynthesis" in window)) { toast("이 브라우저는 음성을 지원하지 않아요"); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\.\.\./g, ""));
  u.lang = "en-US"; u.rate = state.settings.rate;
  const v = speechSynthesis.getVoices().find(v => /^en[-_]US/i.test(v.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// ───────── 이벤트 ─────────
document.addEventListener("click", e => {
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) { show(tabBtn.dataset.tab); return; }
  const seg = e.target.closest("[data-mode]");
  if (seg) { arch.mode = seg.dataset.mode; renderArchive(); return; }
  const chip = e.target.closest("[data-filter]");
  if (chip) { arch.filter = chip.dataset.filter; renderArchive(); return; }
  const a = e.target.closest("[data-act]");
  if (!a) return;
  const act = a.dataset.act;
  if (act === "toggle") { a.closest(".item").classList.toggle("open"); return; }
  if (act === "send") { submitChat(); return; }
  if (act === "mic") { listen(a); return; }
  if (act === "retry") { sendChat(null); return; }  // 마지막 내 메시지로 다시 요청
  if (act === "chatback") { show(backTab); return; }
  if (act === "chatreset") { if (chatBusy) return; state.chats[chatId] = []; save(); chatErr = ""; renderChat(); return; }
  if (act === "speakmsg") { const m = (state.chats[chatId] || [])[+a.dataset.i]; if (m) speak(m.en); return; }
  const id = a.dataset.id, c = BY_ID[id];
  if (!c) return;
  if (act === "speak") { speak(a.dataset.which === "ex" ? c.ex : c.en); return; }
  if (act === "chat") { openChat(id); return; }
  const m = state.marks[id] || (state.marks[id] = {});
  if (act === "star") { m.star = !m.star; toast(m.star ? "즐겨찾기에 담았어요" : "즐겨찾기에서 뺐어요"); }
  if (act === "known") { m.known = !m.known; toast(m.known ? "외운 카드로 표시했어요" : "외움 표시를 풀었어요"); }
  save();
  // 펼쳐 둔 항목은 그대로 유지
  const openIds = [...document.querySelectorAll(".item.open")].map(x => x.dataset.item);
  rerender();
  openIds.forEach(oid => { const el = document.querySelector('.item[data-item="' + oid + '"]'); if (el) el.classList.add("open"); });
});
$("#q").addEventListener("input", e => { arch.q = e.target.value.trim(); renderArchive(); });
$("#hideKo").addEventListener("change", e => { $("#arch-list").classList.toggle("hide-ko", e.target.checked); });

// 자정이 지나 다시 열었을 때 새 카드로 바꿈
document.addEventListener("visibilitychange", () => { if (!document.hidden && tab === "today") renderToday(); });

show("today");

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// 테스트용 노출
window.__eng = { get state() { return state; }, ensureToday, received };
})();
