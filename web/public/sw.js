/* Smart Voice Alarm — background schedule + OS notifications */
/* eslint-disable no-undef */

const SCHEDULE_DB = "sva-bg-schedule";
const SCHEDULE_STORE = "schedule";
const SCHEDULE_KEY = "current";
const VERSION = 1;

/** @type {ReturnType<typeof setTimeout> | null} */
let fallbackTimer = null;
/** @type {string | null} */
let fallbackKey = null;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const schedule = await readSchedule();
      if (schedule) await armSchedule(schedule);
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  const reply = (payload) => {
    try {
      port?.postMessage(payload);
    } catch {
      /* ignore */
    }
  };

  event.waitUntil(
    (async () => {
      try {
        if (data.type === "SYNC_SCHEDULE") {
          await writeSchedule(data.schedule || null);
          await armSchedule(data.schedule || null);
          reply({ ok: true, type: "SYNC_SCHEDULE" });
          return;
        }
        if (data.type === "CANCEL_SCHEDULE") {
          await writeSchedule(null);
          await clearArmedNotifications();
          clearFallbackTimer();
          reply({ ok: true, type: "CANCEL_SCHEDULE" });
          return;
        }
        if (data.type === "PING") {
          reply({ ok: true, type: "PONG", version: VERSION });
          return;
        }
        reply({ ok: false, error: "unknown" });
      } catch (err) {
        reply({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const note = event.notification;
  const payload = (note && note.data) || {};
  note.close();

  event.waitUntil(
    (async () => {
      await notifyClients({ type: "ALARM_FIRE", fire: payload.fire || payload });
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        const fire = payload.fire || {};
        const q = new URLSearchParams();
        q.set("bgRing", "1");
        if (fire.key) q.set("fireKey", String(fire.key));
        if (fire.title) q.set("title", String(fire.title).slice(0, 80));
        if (fire.speakText) q.set("speak", String(fire.speakText).slice(0, 120));
        if (fire.voiceType) q.set("vt", String(fire.voiceType));
        if (fire.recordingId) q.set("rid", String(fire.recordingId));
        if (fire.voiceURI) q.set("vuri", String(fire.voiceURI).slice(0, 120));
        await self.clients.openWindow(`/?${q.toString()}`);
      }
    })(),
  );
});

self.addEventListener("notificationclose", () => {
  /* no-op */
});

function openScheduleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SCHEDULE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SCHEDULE_STORE)) {
        db.createObjectStore(SCHEDULE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readSchedule() {
  try {
    const db = await openScheduleDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEDULE_STORE, "readonly");
      const req = tx.objectStore(SCHEDULE_STORE).get(SCHEDULE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeSchedule(schedule) {
  const db = await openScheduleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEDULE_STORE, "readwrite");
    const store = tx.objectStore(SCHEDULE_STORE);
    if (schedule) store.put(schedule, SCHEDULE_KEY);
    else store.delete(SCHEDULE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function supportsTimestampTrigger() {
  try {
    return (
      typeof TimestampTrigger !== "undefined" &&
      "showTrigger" in Notification.prototype
    );
  } catch {
    return false;
  }
}

async function clearArmedNotifications() {
  try {
    const opts = supportsTimestampTrigger() ? { includeTriggered: true } : {};
    const notes = await self.registration.getNotifications(opts);
    for (const n of notes) {
      if (n.tag && String(n.tag).startsWith("sva-")) n.close();
    }
  } catch {
    /* ignore */
  }
}

function clearFallbackTimer() {
  if (fallbackTimer != null) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  fallbackKey = null;
}

async function armSchedule(schedule) {
  clearFallbackTimer();
  await clearArmedNotifications();
  if (!schedule || !Array.isArray(schedule.fires) || !schedule.fires.length) return;

  const now = Date.now();
  const upcoming = schedule.fires.filter((f) => f && typeof f.at === "number" && f.at > now + 1500);
  if (!upcoming.length) return;

  if (supportsTimestampTrigger()) {
    // Schedule up to 8 upcoming fires with the OS notification scheduler
    for (const fire of upcoming.slice(0, 8)) {
      try {
        await self.registration.showNotification(fire.title || "Alarm", {
          body: buildBody(fire, schedule),
          tag: `sva-${fire.key}`,
          renotify: true,
          requireInteraction: true,
          silent: false,
          vibrate: [300, 120, 300, 120, 300],
          data: { fire, soundType: schedule.soundType, customRingtoneId: schedule.customRingtoneId },
          showTrigger: new TimestampTrigger(fire.at),
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
        });
      } catch (err) {
        console.warn("TimestampTrigger schedule failed", err);
      }
    }
    // Also arm a SW timer so open clients get ALARM_FIRE (TimestampTrigger alone only shows a banner)
    armFallback(upcoming[0], schedule, { notifyOnly: true });
    return;
  }

  // Fallback: timer inside the service worker (best-effort; may be suspended)
  armFallback(upcoming[0], schedule, { notifyOnly: false });
}

function armFallback(fire, schedule, options = {}) {
  clearFallbackTimer();
  const delay = Math.max(0, fire.at - Date.now());
  fallbackKey = fire.key;
  const notifyOnly = Boolean(options.notifyOnly);
  fallbackTimer = setTimeout(() => {
    void onFallbackFire(fire, schedule, notifyOnly);
  }, Math.min(delay, 2147483647));
}

async function onFallbackFire(fire, schedule, notifyOnly = false) {
  fallbackTimer = null;
  fallbackKey = null;
  // When TimestampTrigger already scheduled the OS banner, only wake clients (avoid double notification)
  if (!notifyOnly) {
    await showFireNotification(fire, schedule);
  }
  await notifyClients({
    type: "ALARM_FIRE",
    fire,
    soundType: schedule.soundType,
    customRingtoneId: schedule.customRingtoneId,
  });

  // Re-arm remaining schedule
  const fresh = await readSchedule();
  if (fresh) {
    fresh.fires = (fresh.fires || []).filter((f) => f.key !== fire.key && f.at > Date.now());
    await writeSchedule(fresh);
    await armSchedule(fresh);
  }
}

async function showFireNotification(fire, schedule) {
  try {
    await self.registration.showNotification(fire.title || "Alarm", {
      body: buildBody(fire, schedule),
      tag: `sva-live-${fire.key}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [400, 150, 400, 150, 400, 150, 400],
      data: { fire, soundType: schedule?.soundType, customRingtoneId: schedule?.customRingtoneId },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    });
  } catch (err) {
    console.warn("showNotification failed", err);
  }
}

function buildBody(fire, schedule) {
  const when = new Date(fire.at);
  const hh = String(when.getHours()).padStart(2, "0");
  const mm = String(when.getMinutes()).padStart(2, "0");
  const bits = [`Scheduled ${hh}:${mm}`];
  if (fire.recordingId) bits.push("My voice");
  if (schedule?.soundType) bits.push(`Tone: ${schedule.soundType}`);
  bits.push("Tap to open & ring");
  return bits.join(" · ");
}

async function notifyClients(message) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of all) {
    try {
      client.postMessage(message);
    } catch {
      /* ignore */
    }
  }
}
