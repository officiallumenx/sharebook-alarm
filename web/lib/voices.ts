/** Free voices from the browser / OS via Web Speech API (no paid TTS).
 *  Male / female availability depends entirely on what the device has installed.
 */

export type VoicePersona = "female" | "male" | "child";
/** Detected from the voice name when possible — null if the OS doesn’t label it. */
export type VoiceGender = "female" | "male" | null;

export type ListedVoice = {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  gender: VoiceGender;
  persona: VoicePersona;
};

const FEMALE_RE =
  /female|zira|samantha|karen|moira|victoria|susan|hazel|catherine|aria|jenny|sara|sonia|linda|heather|michelle|eva|anna|emma|amy|natasha|google uk english female|microsoft.*(zira|aria|jenny|sara|sonia)/i;

const MALE_RE =
  /male|david|mark|daniel|james|george|thomas|richard|ravi|guy|ryan|christopher|eric|steffan|andrew|brian|google uk english male|microsoft.*(david|mark|guy|ryan|christopher|eric)/i;

const CHILD_RE = /child|kid|boy|girl|junior|young/i;

function scoreLang(lang: string) {
  const l = lang.toLowerCase();
  if (l.startsWith("en-us") || l.startsWith("en_us")) return 3;
  if (l.startsWith("en-in") || l.startsWith("en_in")) return 3;
  if (l.startsWith("en-gb") || l.startsWith("en_gb")) return 2;
  if (l.startsWith("en")) return 1;
  return 0;
}

/** Only returns male/female when the voice name clearly indicates it. */
export function detectGender(voice: SpeechSynthesisVoice): VoiceGender {
  const label = `${voice.name} ${voice.voiceURI}`;
  if (MALE_RE.test(label)) return "male";
  if (FEMALE_RE.test(label)) return "female";
  return null;
}

export function classifyPersona(voice: SpeechSynthesisVoice): VoicePersona {
  const label = `${voice.name} ${voice.voiceURI}`;
  if (CHILD_RE.test(label)) return "child";
  const gender = detectGender(voice);
  if (gender === "male") return "male";
  if (gender === "female") return "female";
  // Unknown — keep pitch neutral via female defaults (no forced UI category)
  return "female";
}

export function genderLabel(gender: VoiceGender): string | null {
  if (gender === "male") return "Male";
  if (gender === "female") return "Female";
  return null;
}

export function listSystemVoices(): ListedVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis
    .getVoices()
    .map((v) => {
      const gender = detectGender(v);
      return {
        name: v.name,
        lang: v.lang,
        voiceURI: v.voiceURI,
        localService: v.localService,
        gender,
        persona: classifyPersona(v),
      };
    })
    .sort((a, b) => scoreLang(b.lang) - scoreLang(a.lang) || a.name.localeCompare(b.name));
}

/** Group voices for pickers — only includes groups that exist on this device. */
export function groupVoicesByGender(voices: ListedVoice[]) {
  return {
    female: voices.filter((v) => v.gender === "female"),
    male: voices.filter((v) => v.gender === "male"),
    other: voices.filter((v) => v.gender == null),
  };
}

export function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      resolve(existing);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish);
    // Chrome sometimes needs a tick; always settle so callers cannot hang
    setTimeout(finish, 250);
    setTimeout(finish, 1500);
  });
}

/** Pick the best free OS voice for a persona (and optional explicit voiceURI). */
export function resolveVoice(
  persona: VoicePersona,
  preferredURI?: string | null,
): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  if (preferredURI) {
    const exact = voices.find((v) => v.voiceURI === preferredURI || v.name === preferredURI);
    if (exact) return exact;
  }

  const ranked = [...voices].sort((a, b) => scoreLang(b.lang) - scoreLang(a.lang));

  const matchPersona = (want: VoicePersona) =>
    ranked.find((v) => classifyPersona(v) === want) || null;

  if (persona === "male") {
    return (
      matchPersona("male") ||
      ranked.find((v) => MALE_RE.test(v.name)) ||
      ranked[0] ||
      null
    );
  }

  if (persona === "child") {
    return (
      matchPersona("child") ||
      matchPersona("female") ||
      ranked.find((v) => FEMALE_RE.test(v.name)) ||
      ranked[0] ||
      null
    );
  }

  return (
    matchPersona("female") ||
    ranked.find((v) => FEMALE_RE.test(v.name)) ||
    ranked[0] ||
    null
  );
}

export function personaSpeechParams(persona: VoicePersona): { pitch: number; rate: number } {
  if (persona === "child") return { pitch: 1.55, rate: 1.08 };
  if (persona === "male") return { pitch: 0.82, rate: 0.92 };
  return { pitch: 1.08, rate: 1.0 };
}
