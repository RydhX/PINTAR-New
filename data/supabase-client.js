import { createClient } from "@supabase/supabase-js";

async function initializeSupabase() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error(`Configuration request failed (${response.status}).`);
    }

    const { supabaseUrl, supabaseAnonKey } = await response.json();
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn(
        "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY to enable the Supabase client.",
      );
      return;
    }

    window.pintarSupabase = createClient(supabaseUrl, supabaseAnonKey);
  } catch (error) {
    console.warn("Supabase client initialization failed:", error);
  }
}

initializeSupabase();
