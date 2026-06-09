// Supabase connection for the daily leaderboard.
// The anon (publishable) key is SAFE to expose in client code — access is limited
// by Row Level Security (see supabase/schema.sql). Fill these in to enable the
// global board; leave empty and the game still works (streaks/stats stay local).
export const SUPABASE_URL = "";       // e.g. https://abcdxyz.supabase.co
export const SUPABASE_ANON_KEY = "";  // the "anon"/"publishable" key
