# Security hardening applied

## What was changed

1. Backend auth fallback was locked down.
   - The server no longer trusts `uid` from the request body in production.
   - Insecure UID fallback now works only when:
     - `CHROMANCY_ALLOW_INSECURE_UID_FALLBACK=true`
     - the request is local development only
   - Default is `false`.

2. Premium usage consumption now uses verified auth.
   - `/api/usage/consume-access` now derives the account from the verified Firebase ID token.
   - Pro access cannot be consumed without verified login.

3. Firestore rules were tightened.
   - Client-side updates can no longer change `users/{userId}.tier`.
   - This prevents users from promoting themselves from `free` to `pro` or `pay-as-you-use` directly from the client.

4. Environment variable guidance was corrected.
   - README now instructs that Gemini/OpenAI/webhook secrets stay on the backend only.
   - `.env.example` now includes `CHROMANCY_ALLOW_INSECURE_UID_FALLBACK=false`.

## Important notes

- Firebase client config values such as the web API key in `firebase-applet-config.json` and `google-services.json` are not secret credentials. They are normal public Firebase app identifiers.
- RevenueCat public SDK keys are also intended for client-side use. Secret RevenueCat webhook secrets must stay on the server only.
- You should still keep your real `.env` / `.env.local` files out of git and out of shared zips.
- For production, make sure Firebase Admin credentials are configured on the backend so token verification always works.
