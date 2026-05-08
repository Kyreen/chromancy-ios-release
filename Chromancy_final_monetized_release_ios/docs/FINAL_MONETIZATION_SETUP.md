# Final Monetization Setup

This build now expects the backend to be the source of truth for:

- wallet balance
- refund reversals
- subscription status
- subscription cycle dates
- monthly AI credits
- AI charge holds and failed-request releases
- Pro vs Premium tier resolution

## Product IDs

Use these exact IDs:

- Google Play subscription: `chromancy_pro`
- Google Play base plan: `monthly`
- RevenueCat Android Pro product: `chromancy_pro:monthly`
- Google Play Premium subscription: `chromancy_premium`
- Google Play Premium base plan: `monthly`
- RevenueCat Android Premium product: `chromancy_premium:monthly`
- App Store Pro subscription: `chromancy_pro`
- App Store Premium subscription: `chromancy_premium`
- Wallet top-ups on both stores:
  - `chromancy_wallet_50`
  - `chromancy_wallet_100`
  - `chromancy_wallet_200`
  - `chromancy_wallet_500`

Reference config files:

- [billing-config/revenuecat-products.json](/C:/Users/Kyreen/Documents/Playground/cf/Chromancy_free_test_release/Chromancy_free_test_release/billing-config/revenuecat-products.json)
- [billing-config/play-store-products.json](/C:/Users/Kyreen/Documents/Playground/cf/Chromancy_free_test_release/Chromancy_free_test_release/billing-config/play-store-products.json)
- [billing-config/app-store-products.json](/C:/Users/Kyreen/Documents/Playground/cf/Chromancy_free_test_release/Chromancy_free_test_release/billing-config/app-store-products.json)

## RevenueCat

1. Create entitlement `pro`.
2. Attach both subscriptions to that entitlement:
   - Android `chromancy_pro:monthly`
   - Android `chromancy_premium:monthly`
   - iOS `chromancy_pro`
   - iOS `chromancy_premium`
3. Create offering `default`.
4. Add package `pro_monthly` pointing to Pro.
5. Add package `premium_monthly` pointing to Premium.
6. Add non-subscription products for all four wallet top-ups.
7. Add webhook URL:
   - `https://YOUR_BACKEND_DOMAIN/api/billing/revenuecat-webhook`
8. Set RevenueCat webhook authorization header:
   - `Bearer YOUR_REVENUECAT_WEBHOOK_SECRET`

## Firebase

1. In Firebase Auth, enable:
   - Email/Password
   - Google
2. Add authorized domains for your real app/backend hosts.
3. Deploy [firestore.rules](/C:/Users/Kyreen/Documents/Playground/cf/Chromancy_free_test_release/Chromancy_free_test_release/firestore.rules).
4. Make sure the backend has Firebase Admin credentials.
5. Set these backend env vars:
   - `FIREBASE_SERVICE_ACCOUNT_JSON`
   - `REVENUECAT_WEBHOOK_SECRET`
   - `CHROMANCY_USAGE_SALT`
   - `CHROMANCY_USE_LOCAL_USAGE_STORE=false`
   - `CHROMANCY_FREE_TEST_MODE=false`
   - `CHROMANCY_ALLOW_INSECURE_UID_FALLBACK=false`
6. Set these frontend env vars:
   - `VITE_REVENUECAT_PUBLIC_ANDROID_KEY`
   - `VITE_REVENUECAT_PUBLIC_IOS_KEY`
   - `VITE_RC_PRO_ENTITLEMENT=pro`
   - `VITE_PLAY_PRO_PRODUCT_ID=chromancy_pro:monthly`
   - `VITE_PLAY_PREMIUM_PRODUCT_ID=chromancy_premium:monthly`
   - `VITE_APPLE_PRO_PRODUCT_ID=chromancy_pro`
   - `VITE_APPLE_PREMIUM_PRODUCT_ID=chromancy_premium`

## Google Play

1. In Play Console, create the subscription `chromancy_pro`.
2. Add base plan `monthly` at `R179.99`.
3. Create the subscription `chromancy_premium`.
4. Add base plan `monthly` at `R249.99`.
5. Create one-time products:
   - `chromancy_wallet_50`
   - `chromancy_wallet_100`
   - `chromancy_wallet_200`
   - `chromancy_wallet_500`
6. Add tester accounts under license testing.
7. Upload an internal testing build and install from Play, not directly from Android Studio, before store purchase tests.

## App Store

1. Add the In-App Purchase capability to the iOS target in Xcode.
2. Create one subscription group:
   - `chromancy_ai_plans`
3. Create auto-renewable subscriptions:
   - `chromancy_pro`
   - `chromancy_premium`
4. Create consumables:
   - `chromancy_wallet_50`
   - `chromancy_wallet_100`
   - `chromancy_wallet_200`
   - `chromancy_wallet_500`
5. Match those IDs exactly in RevenueCat.
6. Use the nearest App Store price points to the ZAR reference prices in the App Store config JSON.

## Local Simulation

Use the local billing simulator after starting the backend in local mode:

1. Start the server with local billing-friendly flags:
   - `CHROMANCY_USE_LOCAL_USAGE_STORE=true`
   - `CHROMANCY_ALLOW_INSECURE_UID_FALLBACK=true`
   - `CHROMANCY_FREE_TEST_MODE=false`
   - `REVENUECAT_WEBHOOK_SECRET=your-test-secret`
2. Run:

```powershell
node .\scripts\simulate-billing-flows.mjs
```

The script verifies:

- wallet top-up crediting
- failed AI requests do not keep wallet deductions
- Pro activation
- billing-anniversary credit reset on renewal
- Premium upgrade
- billing issue state tracking
- wallet refund reversal
- subscription expiration clearing credits

Simulator file:

- [scripts/simulate-billing-flows.mjs](/C:/Users/Kyreen/Documents/Playground/cf/Chromancy_free_test_release/Chromancy_free_test_release/scripts/simulate-billing-flows.mjs)

## Outstanding

- There is no `ios/` Capacitor project in this Windows workspace yet. You still need to run `npx cap add ios` and complete Xcode signing/capabilities on a Mac.
- Real store validation still requires live tester accounts on Google Play and App Store sandbox.
- The backend must be deployed with Firebase Admin credentials and the RevenueCat webhook secret before production purchases will sync correctly.
- If you want server-enforced premium media exports instead of client-side export mode differences, the export pipeline would need to move to the backend as a separate follow-up.
