# Chromancy

> AI-powered image generation for iOS & Android

---

## Overview

Chromancy is a cross-platform mobile application that leverages AI to generate images from user prompts. Built with a modern React/TypeScript frontend and a Firebase backend, the app delivers a seamless experience across both iOS and Android devices.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Capacitor](https://capacitorjs.com/) |
| Frontend | React + TypeScript |
| Backend / Auth | Firebase |
| Subscriptions | RevenueCat |
| AI | Google Gemini / Veo |

---

## Features

- **AI Image & Video Generation** — Generate images and animated clips from text prompts using Google's Gemini and Veo models
- **Authentication** — Native Google Sign-In and Apple Sign-In (Sign in with Apple)
- **Subscriptions & Wallet** — In-app purchases and subscription management via RevenueCat
- **Cross-Platform** — Targets both iOS and Android from a single codebase

---

## Project Info

| Property | Value |
|---|---|
| Bundle ID | `com.chromancy.app` |
| Firebase Project ID | `chromancy-699a7` |
| Platforms | iOS, Android |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Xcode (for iOS builds)
- Android Studio (for Android builds)
- Firebase project configured
- RevenueCat account

### Installation

```bash
# Install dependencies
npm install

# Build the web layer
npm run build

# Sync to native platforms
npx cap sync
```

### Environment Variables

Copy `.env.production` and populate the required keys:

```env
VITE_GOOGLE_IOS_CLIENT_ID=
VITE_REVENUECAT_PUBLIC_IOS_KEY=
# ... other keys
```

### Running on iOS

```bash
npx cap open ios
# Then build and run from Xcode
```

### Running on Android

```bash
npx cap open android
# Then build and run from Android Studio
```

---

## Project Structure

```
chromancy/
├── src/                  # React/TypeScript source
│   ├── pages/            # App pages
│   ├── components/       # Reusable UI components
│   └── services/         # Firebase, AI, billing services
├── ios/                  # Native iOS project (Xcode)
├── android/              # Native Android project
├── server/               # Backend / AI server logic
│   └── server-ai.ts      # AI image & video generation
└── capacitor.config.ts   # Capacitor configuration
```

---

## Author

**Kyreen N. Ramklowan**
[kyreennr@gmail.com](mailto:kyreennr@gmail.com)

---

## License

Private — All rights reserved © 2026 Kyreen N. Ramklowan