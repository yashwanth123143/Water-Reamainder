import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the env vars are missing: the app then runs on this device only. */
export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Resolves true when the user is signed in right away, false when Supabase still wants email confirmation. */
export async function signUpWithPassword(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return Boolean(data.session);
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Calls cb with the current session now, then on every sign-in or sign-out. */
export function watchSession(cb) {
  supabase.auth.getSession().then(({ data }) => cb(data.session));
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/** Everything the app needs for this user, in the shape the app uses. */
export async function fetchAll(userId) {
  const [settings, logs, rewards] = await Promise.all([
    supabase.from("water_settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("water_logs").select("day, glasses").eq("user_id", userId)
      .order("day", { ascending: false }).limit(120),
    supabase.from("water_rewards").select("*").eq("user_id", userId)
      .order("day", { ascending: false }).limit(400),
  ]);
  for (const r of [settings, logs, rewards]) if (r.error) throw r.error;
  const logMap = {};
  logs.data.forEach((r) => { logMap[r.day] = r.glasses; });
  const rewardMap = {};
  rewards.data.forEach((r) => { rewardMap[r.day] = rowToReward(r); });
  return {
    settings: settings.data ? rowToSettings(settings.data) : null,
    log: logMap,
    rewards: rewardMap,
  };
}

export async function saveSettings(userId, s) {
  const { error } = await supabase.from("water_settings").upsert({
    user_id: userId,
    interval_min: s.interval,
    goal: s.goal,
    glass_ml: s.glassMl,
    day_start: s.start,
    day_end: s.end,
    sound: !!s.sound,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function saveLog(userId, day, glasses) {
  const { error } = await supabase.from("water_logs").upsert({
    user_id: userId, day, glasses, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function saveReward(userId, day, r) {
  const { error } = await supabase.from("water_rewards").upsert({
    user_id: userId, day, shape: r.shape, color: r.color, name: r.name,
    gold: !!r.gold, title: r.title || "",
  });
  if (error) throw error;
}

/** Live changes from the user's other devices. Returns an unsubscribe function. */
export function subscribe(userId, handlers) {
  const filter = `user_id=eq.${userId}`;
  const channel = supabase
    .channel(`water-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "water_settings", filter },
      (p) => p.new && p.new.user_id && handlers.settings(rowToSettings(p.new)))
    .on("postgres_changes", { event: "*", schema: "public", table: "water_logs", filter },
      (p) => p.new && p.new.day && handlers.log(p.new.day, p.new.glasses))
    .on("postgres_changes", { event: "*", schema: "public", table: "water_rewards", filter },
      (p) => p.new && p.new.day && handlers.reward(p.new.day, rowToReward(p.new)))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

function rowToSettings(r) {
  return {
    interval: r.interval_min, goal: r.goal, glassMl: r.glass_ml,
    start: r.day_start, end: r.day_end, sound: r.sound,
  };
}
function rowToReward(r) {
  return { shape: r.shape, color: r.color, name: r.name, gold: r.gold, title: r.title || "" };
}
