# CHROMANCY Real-Device Release QA

Run this checklist before every Play Console or TestFlight release. The static script catches release blockers, but the app still needs real-device testing because billing, media permissions, Google/Apple auth, camera/gallery, and exports depend on native stores and device APIs.

## 1. Static Release Gate

```bash
npm run lint
npm run build
npm run qa:release
npm audit --omit=dev --audit-level=high
```

Expected result:

- `lint` passes with no TypeScript errors.
- `build` completes and generates `dist`.
- `qa:release` reports no blockers.
- Production dependency audit has no high/critical issues. If npm reports only Firebase Admin transitive low/moderate findings with a breaking downgrade as the proposed fix, document and monitor the upstream patch instead of forcing the downgrade.

## 2. Production Secrets Gate

Verify these are set in the production host or native release environment, not left blank:

- `GEMINI_API_KEY`
- `REVENUECAT_WEBHOOK_SECRET`
- `CHROMANCY_USAGE_SALT`
- `CHROMANCY_FREE_TEST_MODE=false`
- `CHROMANCY_CRASH_LOGS_ENABLED=true` if crash logs are declared in Play Console/App Store Connect
- `CHROMANCY_SUPPORT_SMTP_HOST`, `CHROMANCY_SUPPORT_SMTP_USER`, `CHROMANCY_SUPPORT_SMTP_PASS`, and `CHROMANCY_SUPPORT_FROM=info@chromancy.online`
- RevenueCat public Android/iOS keys and product IDs

## 3. Real Device Smoke Test

Use a clean install on at least one low/mid Android device, one newer Android device, and one physical iPhone before store submission.

- Launch app fresh, accept terms, navigate every bottom tab.
- Create an email account, log out, log back in, reset password.
- Sign in with Google on Android and confirm it lands back in the app.
- On iOS, keep Google sign-in disabled unless Sign in with Apple is enabled and tested.
- Confirm free-test mode does not bypass charges unless the review UID/email is allowlisted.
- Open Wallet, buy/top-up in sandbox/internal testing, confirm wallet balance and transaction history.
- Buy subscription in sandbox/internal testing, confirm entitlement, AI credit balance, and restore purchase.
- Run every paid AI tool and confirm the confirmation popup shows exact wallet/credit cost before charging.
- Force an AI failure/offline state and confirm the held charge is refunded.
- Run CREATE and confirm the generated graphic exports correctly and appears in history.
- Run ANIMATE and confirm success/failure does not hang and billing is correct.
- Export photo, design, video, Beam Mode, and Video Enhancer outputs.
- Confirm free-user video exports include the CHROMANCY watermark where required.
- Delete account, confirm Firebase account is gone, server usage is purged, and local history disappears.
- Deny permissions once, then re-enable permissions and confirm camera/gallery/export flows recover.
- Close and reopen during AI processing; confirm the app does not corrupt history or double-charge.
- Trigger a test crash in a dev-only build and confirm a sanitized record appears in `client_crashes` or `data/client-crashes.jsonl`.

## 4. Store-Specific Checks

Android:

- Build with Android Studio using the final signing configuration and release keystore.
- Confirm SHA fingerprints are registered in Firebase for Google sign-in.
- Confirm `android:allowBackup="false"` remains in `android/app/src/main/AndroidManifest.xml`.
- Upload to internal testing first and verify RevenueCat purchases with licensed testers.

iOS:

- If Google sign-in is enabled in the iOS UI, Sign in with Apple must also be enabled before App Store review.
- Confirm all privacy permission strings are present in `ios/App/App/Info.plist`.
- Archive from Xcode with a real Apple Developer team, RevenueCat iOS key, and App Store product IDs.

## 5. Release Decision

Do not submit if any of these fail:

- Billing charges without clear user confirmation.
- Failed generations are not refunded.
- CREATE generates a blank or unusable graphic.
- Export/save is broken for any major tool.
- Delete account leaves the user able to log back into the same account.
- RevenueCat webhook accepts production events without `REVENUECAT_WEBHOOK_SECRET`.
- Crash logs are declared but `CHROMANCY_CRASH_LOGS_ENABLED` is not enabled.
