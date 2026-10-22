import { createClient } from "npm:@supabase/supabase-js@2";

// One-time Yahoo authorization. Visit this function's URL once, approve access on Yahoo,
// and the refresh token is stored for the scheduled sync to use.
// verify_jwt is off because Yahoo's redirect carries no Supabase JWT; the function guards itself:
//  - the start step only works while no token is stored (one-shot)
//  - the callback only accepts a state value this function issued

const FUNCTION_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/yahoo-auth`;
const CLIENT_ID = Deno.env.get("YAHOO_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("YAHOO_CLIENT_SECRET") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return text("Yahoo client ID/secret are not set yet.", 500);
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return text(`Yahoo returned an error: ${error}`, 400);

  // Step 1: start the flow
  if (!code) {
    const { data: existing } = await db.from("yahoo_tokens").select("id").maybeSingle();
    if (existing) {
      return text("Yahoo is already authorized. Ask Claude to reset it if you need to re-authorize.", 409);
    }
    const newState = crypto.randomUUID();
    await db.from("oauth_states").insert({ state: newState });
    const auth = new URL("https://api.login.yahoo.com/oauth2/request_auth");
    auth.searchParams.set("client_id", CLIENT_ID);
    auth.searchParams.set("redirect_uri", FUNCTION_URL);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "fspt-r");
    auth.searchParams.set("state", newState);
    auth.searchParams.set("language", "en-us");
    return Response.redirect(auth.toString(), 302);
  }

  // Step 2: Yahoo sent the user back with a code
  if (!state) return text("Missing state.", 400);
  const { data: valid } = await db.from("oauth_states").select("state").eq("state", state).maybeSingle();
  if (!valid) return text("Unknown or already-used state. Start again from the beginning.", 400);
  await db.from("oauth_states").delete().eq("state", state);

  const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: FUNCTION_URL,
      code,
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.refresh_token) {
    return text(`Token exchange failed (${res.status}): ${tok.error_description ?? tok.error ?? "unknown"}`, 502);
  }

  const { error: saveErr } = await db.from("yahoo_tokens").upsert({
    id: 1,
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (saveErr) return text(`Could not save token: ${saveErr.message}`, 500);

  return text("Yahoo is connected. You can close this tab and tell Claude it worked.");
});
