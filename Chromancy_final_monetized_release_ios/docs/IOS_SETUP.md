# iOS Setup Guide

This folder is the iOS-ready copy of the final Android project.

## What is already done
- Capacitor iOS platform added
- Xcode project generated in `ios/App`
- iOS package scripts added to `package.json`
- iOS Google sign-in env hooks added to `src/lib/firebase.ts`
- iOS RevenueCat public key env hook already supported in `src/lib/billing.ts`
- iOS camera, microphone, and photo-library permission strings added to `ios/App/App/Info.plist`
- Native iOS file export/save bridge added for images, videos, PDFs, and other generated files
- Native iOS Beam Mode screen helper added for screen brightness and keep-awake behavior
- Files app sharing enabled for exported documents saved into the app container

## What you still need to do on a Mac
1. Install Xcode and Apple command-line tools.
2. Copy this folder to the Mac.
3. In the project root, run:
   - `npm install`
   - `npm run build`
   - `npx cap sync ios`
4. Open the iOS project:
   - `npx cap open ios`
5. In Xcode, set your Apple Team and signing for the `App` target.
6. Confirm the bundle identifier is the iOS app ID you want to ship.
7. Build and archive from Xcode on a real Mac.

## Google sign-in for iOS
Set these environment variables before the iOS build:
- `VITE_GOOGLE_IOS_CLIENT_ID`
- `VITE_GOOGLE_IOS_SERVER_CLIENT_ID`
- `VITE_GOOGLE_WEB_CLIENT_ID` if you do not want to fall back to the Android Firebase config file

Use the iOS OAuth client ID from Google/Firebase.

In Xcode, add the reversed iOS client ID to `Info > URL Types > URL Schemes`.
This is required for Google sign-in callback handling on iPhone.

## App Store policy note for login
Apple's current review rules can require Sign in with Apple when a third-party login such as Google Sign-In is offered for the app's primary account.
If you keep Google sign-in enabled on iOS, plan to either:
- add Sign in with Apple before submission, or
- remove Google sign-in from the iOS build.

## RevenueCat for iOS
Set these environment variables before the iOS build:
- `VITE_REVENUECAT_PUBLIC_IOS_KEY`
- `VITE_APPLE_PRO_PRODUCT_ID`
- `VITE_APPLE_PREMIUM_PRODUCT_ID`

Then make sure the same products exist in App Store Connect and RevenueCat.

## Apple store products
Create these in App Store Connect:
- Subscription: Pro Monthly
- Subscription: Premium Monthly
- Consumables / one-time wallet top-ups matching the product IDs used by the app

## Firebase for iOS
If you want a native iOS Firebase app entry in Firebase Console, create one for the same bundle ID and keep its values aligned with this app.
The web Firebase config already drives the JS app, but Google sign-in on iOS still needs the iOS OAuth client configuration described above.

## Permissions already declared
- Camera
- Microphone
- Photo library read
- Photo library save

## Export behavior on iOS
- Images and videos save to the user's Photos library
- PDFs and other exported documents save to the app's Documents/ChromancyExports folder and appear in the Files app

## Recommended first test on Mac
1. Build and run on a real iPhone.
2. Test email sign-in.
3. Verify email/password login on iPhone and confirm the Google button is intentionally hidden on iOS.
4. Test Beam Mode camera/microphone permissions.
5. Test photo/video picking.
6. Test image, video, and document exports.
7. Test RevenueCat initialization, purchases, and restore purchases.
8. Test account deletion.

## Important limitation
This project is now iOS-prepared, but a real iOS binary, signing archive, TestFlight upload, and App Store submission must be done from a Mac with Xcode.

