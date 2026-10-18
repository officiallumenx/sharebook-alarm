/** Only real user labels are spoken. Empty / old auto-fill phrases → ringtone only. */
export function spokenAlarmText(label?: string) {
  const text = (label || "").trim();
  if (!text) return "";
  const muted = new Set([
    "alarm",
    "alarm ringing",
    "alarm ringing!",
    "smart voice alarm",
    "my voice alarm",
    "timer finished",
    "timer finished!",
  ]);
  if (muted.has(text.toLowerCase())) return "";
  if (/^snoozed:\s*alarm$/i.test(text)) return "";
  return text;
}
