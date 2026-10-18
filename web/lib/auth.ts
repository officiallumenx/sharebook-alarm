export type Gender = "male" | "female" | "other" | "prefer_not";

export type UserProfile = {
  phone: string;
  name: string;
  age: number;
  gender: Gender;
  passwordHash: string;
  /** Optional profile photo as a compressed data URL */
  photo?: string;
  /** Short line shown under the name */
  tagline?: string;
  /** Longer about text */
  bio?: string;
  createdAt: string;
};

/** Public user shape without password hash. */
export type PublicUser = Omit<UserProfile, "passwordHash">;

const USERS_KEY = "chrono_users";
const SESSION_KEY = "chrono_session_phone";
const MIN_PASSWORD = 6;
/** Local-only guest session — no phone/password required */
export const GUEST_PHONE = "__guest__";

function readUsers(): UserProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? (JSON.parse(raw) as UserProfile[]) : [];
  } catch {
    return [];
  }
}

function writeUsers(users: UserProfile[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toPublic(user: UserProfile): PublicUser {
  const { passwordHash: _pw, ...rest } = user;
  return rest;
}

export function getSessionPhone(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}

export function getCurrentUser(): PublicUser | null {
  const phone = getSessionPhone();
  if (!phone) return null;
  const user = readUsers().find((u) => u.phone === phone);
  return user ? toPublic(user) : null;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

export function isGuestUser(user: PublicUser | null | undefined): boolean {
  return Boolean(user && user.phone === GUEST_PHONE);
}

/** Skip login — enter the app as a local guest (data stays on this device). */
export function continueAsGuest(): PublicUser {
  const users = readUsers();
  let guest = users.find((u) => u.phone === GUEST_PHONE);
  if (!guest) {
    guest = {
      phone: GUEST_PHONE,
      name: "Guest",
      age: 18,
      gender: "prefer_not",
      passwordHash: "",
      tagline: "hello ALL",
      createdAt: new Date().toISOString(),
    };
    writeUsers([...users, guest]);
  }
  localStorage.setItem(SESSION_KEY, GUEST_PHONE);
  return toPublic(guest);
}

export async function loginWithPhone(
  phone: string,
  password: string,
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) {
    return { ok: false, error: "Enter a valid phone number (at least 8 digits)." };
  }
  if (!password || password.length < MIN_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }

  const user = readUsers().find((u) => u.phone === normalized);
  if (!user) {
    return { ok: false, error: "No account found for this number. Please register." };
  }

  // Legacy accounts created before passwords existed
  if (!user.passwordHash) {
    return { ok: false, error: "This account needs to register again with a password." };
  }

  const hash = await hashPassword(password);
  if (hash !== user.passwordHash) {
    return { ok: false, error: "Incorrect password. Try again." };
  }

  localStorage.setItem(SESSION_KEY, normalized);
  return { ok: true, user: toPublic(user) };
}

export async function registerUser(input: {
  phone: string;
  name: string;
  age: string | number;
  gender: Gender;
  password: string;
  confirmPassword: string;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const phone = normalizePhone(input.phone);
  const name = input.name.trim();
  const age = typeof input.age === "number" ? input.age : parseInt(String(input.age), 10);
  const password = input.password;
  const confirmPassword = input.confirmPassword;

  if (phone.length < 8) {
    return { ok: false, error: "Enter a valid phone number (at least 8 digits)." };
  }
  if (name.length < 2) {
    return { ok: false, error: "Please enter your full name." };
  }
  if (!Number.isFinite(age) || age < 5 || age > 120) {
    return { ok: false, error: "Enter a valid age between 5 and 120." };
  }
  if (!input.gender) {
    return { ok: false, error: "Please select your gender." };
  }
  if (!password || password.length < MIN_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: "Password and confirm password do not match." };
  }

  const users = readUsers();
  if (users.some((u) => u.phone === phone)) {
    return { ok: false, error: "This phone number is already registered. Please log in." };
  }

  const passwordHash = await hashPassword(password);
  const user: UserProfile = {
    phone,
    name,
    age,
    gender: input.gender,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  writeUsers([...users, user]);
  localStorage.setItem(SESSION_KEY, phone);
  return { ok: true, user: toPublic(user) };
}

export function updateUserProfile(
  phone: string,
  patch: Partial<Pick<UserProfile, "name" | "age" | "gender" | "photo" | "tagline" | "bio">>,
): PublicUser | null {
  // Guests cannot set a full profile — require login / register first
  if (phone === GUEST_PHONE) return null;
  const users = readUsers();
  const idx = users.findIndex((u) => u.phone === phone);
  if (idx < 0) return null;
  const next = { ...users[idx], ...patch };
  users[idx] = next;
  writeUsers(users);
  return toPublic(next);
}

/** Compress an image file to a small JPEG data URL for localStorage. */
export function compressImageFile(file: File, maxSize = 320, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image."));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function genderLabel(g: Gender) {
  if (g === "male") return "Male";
  if (g === "female") return "Female";
  if (g === "other") return "Other";
  return "Prefer not to say";
}

export const MIN_PASSWORD_LENGTH = MIN_PASSWORD;
