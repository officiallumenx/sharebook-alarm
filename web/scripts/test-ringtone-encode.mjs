/**
 * Verifies ringtone base64 encoding is lossless for large files
 * and that bundled alarm_loop.wav is long enough to loop.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- bundled tone duration ---
const loopPath = path.join(root, "android/app/src/main/res/raw/alarm_loop.wav");
assert(fs.existsSync(loopPath), "alarm_loop.wav missing");
const wav = fs.readFileSync(loopPath);
const sr = wav.readUInt32LE(24);
const dataBytes = wav.readUInt32LE(40);
const dur = dataBytes / 2 / sr;
assert(dur >= 5, `alarm_loop too short: ${dur}s`);
console.log(`ok alarm_loop.wav duration=${dur.toFixed(2)}s`);

// --- base64 round-trip for large buffer (simulates custom ringtone) ---
const size = 512 * 1024; // 512KB
const bytes = Buffer.alloc(size);
for (let i = 0; i < size; i++) bytes[i] = i % 251;
const b64 = bytes.toString("base64");
const back = Buffer.from(b64, "base64");
assert(back.equals(bytes), "base64 round-trip failed");
console.log(`ok base64 round-trip ${size} bytes`);

// --- chunked fromCharCode style (old buggy path with large spread) ---
function chunkedB64(buf, chunk) {
  let binary = "";
  for (let i = 0; i < buf.length; i += chunk) {
    const slice = buf.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return Buffer.from(binary, "binary").toString("base64");
}
const b64chunk = chunkedB64(bytes, 0x2000);
assert(Buffer.from(b64chunk, "base64").equals(bytes), "chunked encode failed");
console.log("ok chunked 8KB encode");

// --- cancelAll must not stop ringing (source contract) ---
const helper = fs.readFileSync(
  path.join(root, "android/app/src/main/java/com/smartvoice/alarm/AlarmFullScreenHelper.java"),
  "utf8",
);
assert(
  helper.includes("cancelAllPending(context, false)"),
  "scheduleAll must cancel pending without stopping ring",
);
// cancelAll() itself must only delegate without stopping ring
const cancelAllFn = helper.match(
  /public static void cancelAll\(Context context\) \{\s*cancelAllPending\(context, false\);\s*\}/,
);
assert(Boolean(cancelAllFn), "cancelAll() must call cancelAllPending(..., false) only");
console.log("ok cancelAll does not stop ringing service");

const bg = fs.readFileSync(path.join(root, "lib/background-alarms.ts"), "utf8");
assert(bg.includes("isNativeAlarmRinging"), "sync must skip while ringing");
console.log("ok background sync skips while ringing");

console.log("\nAll ringtone regression checks passed.");
