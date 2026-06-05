import { initializeApp } from "firebase/app";
import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { browserLocalPersistence, getAuth, GoogleAuthProvider, initializeAuth, indexedDBLocalPersistence, OAuthProvider, signInWithPopup, sendPasswordResetEmail, setPersistence, signOut, deleteUser, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, User as FirebaseUser, EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, signInWithCredential } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { BundleWallet, UserProfile, Project } from "../types";
import { buildApiUrl } from "./api-base";
import { clearDeviceId } from "./device";
import { clearLocalHistory } from "./localHistory";

// Import the Firebase configuration
// This file is created by the AIS Agent after the user accepts the terms
import firebaseConfig from "../../firebase-applet-config.json";
import googleServicesConfig from "../../android/app/google-services.json";

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
const firestoreDatabaseId = typeof firebaseConfig?.firestoreDatabaseId === "string" ? firebaseConfig.firestoreDatabaseId.trim() : "";
export const db = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
function createAuthInstance() {
  try {
    return initializeAuth(app, {
      persistence: Capacitor.isNativePlatform()
        ? [browserLocalPersistence, indexedDBLocalPersistence]
        : [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuthInstance();
export const googleProvider = new GoogleAuthProvider();
export const appleProvider = new OAuthProvider("apple.com");
auth.useDeviceLanguage();
googleProvider.setCustomParameters({ prompt: "select_account" });
appleProvider.addScope("email");
appleProvider.addScope("name");

const primaryPersistence = Capacitor.isNativePlatform() ? browserLocalPersistence : indexedDBLocalPersistence;
const fallbackPersistence = Capacitor.isNativePlatform() ? indexedDBLocalPersistence : browserLocalPersistence;

const authPersistenceReady = setPersistence(auth, primaryPersistence)
  .catch(() => setPersistence(auth, fallbackPersistence))
  .catch((error) => {
    console.warn("Could not set Firebase auth persistence on startup", error);
  });

export async function ensureAuthPersistenceReady() {
  await authPersistenceReady;
}

void ensureAuthPersistenceReady();

function extractGoogleWebClientId(config: any): string {
  const clients = Array.isArray(config?.client) ? config.client : [];

  for (const client of clients) {
    const oauthClients = Array.isArray(client?.oauth_client) ? client.oauth_client : [];
    const directWebClient = oauthClients.find((entry: any) => Number(entry?.client_type) === 3 && typeof entry?.client_id === "string" && entry.client_id.trim());
    if (directWebClient?.client_id) {
      return directWebClient.client_id.trim();
    }

    const fallbackClients = Array.isArray(client?.services?.appinvite_service?.other_platform_oauth_client)
      ? client.services.appinvite_service.other_platform_oauth_client
      : [];
    const fallbackWebClient = fallbackClients.find((entry: any) => Number(entry?.client_type) === 3 && typeof entry?.client_id === "string" && entry.client_id.trim());
    if (fallbackWebClient?.client_id) {
      return fallbackWebClient.client_id.trim();
    }
  }

  return "";
}

const GOOGLE_WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || extractGoogleWebClientId(googleServicesConfig)).trim();
const GOOGLE_IOS_CLIENT_ID = (import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID || "").trim();
const GOOGLE_IOS_SERVER_CLIENT_ID = (import.meta.env.VITE_GOOGLE_IOS_SERVER_CLIENT_ID || GOOGLE_WEB_CLIENT_ID).trim();
const APPLE_CLIENT_ID = (import.meta.env.VITE_APPLE_CLIENT_ID || "com.chromancy.app").trim();
let nativeGoogleInitPromise: Promise<void> | null = null;
let nativeAppleInitPromise: Promise<void> | null = null;

export function isNativeGoogleLoginConfigured() {
  if (!Capacitor.isNativePlatform()) return true;
  if (Capacitor.getPlatform() !== "ios") return Boolean(GOOGLE_WEB_CLIENT_ID);
  // GOOGLE_IOS_CLIENT_ID is set to the web client ID, whose reversed form
  // (com.googleusercontent.apps.51608421110-r384r8dnhr50kcqcrg1ptu80kjitp45c)
  // is already registered as a CFBundleURLScheme in Info.plist — so GIDSignIn
  // can complete the OAuth redirect with it.
  return Boolean(GOOGLE_WEB_CLIENT_ID && GOOGLE_IOS_CLIENT_ID);
}

export function isNativeAppleLoginConfigured() {
  return !Capacitor.isNativePlatform() || Capacitor.getPlatform() === "ios";
}

function getSocialLoginIdToken(result: any): string | null {
  const candidates = [
    result?.idToken,
    result?.identityToken,
    result?.jwt,
    result?.authentication?.idToken,
    result?.authentication?.identityToken,
    result?.authorization?.idToken,
    result?.authorization?.identityToken,
  ];

  const token = candidates.find((value) => typeof value === "string" && value.trim());
  return token ? token.trim() : null;
}

function isUserCancelledAuth(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  const code = String((error as any)?.code || "").toLowerCase();
  return code.includes("cancel") || message.includes("cancel") || message.includes("closed") || message.includes("dismiss");
}

async function ensureNativeGoogleLoginInitialized() {
  if (!Capacitor.isNativePlatform()) return;
  if (nativeGoogleInitPromise) return nativeGoogleInitPromise;

  nativeGoogleInitPromise = (async () => {
    const isIos = Capacitor.getPlatform() === "ios";

    if (!GOOGLE_WEB_CLIENT_ID) {
      throw new Error("Google sign-in is missing its Web client ID. Add the Google Web client to Firebase and refresh google-services.json.");
    }

    if (isIos && !GOOGLE_IOS_CLIENT_ID) {
      throw new Error("Google sign-in on iOS is missing VITE_GOOGLE_IOS_CLIENT_ID. Add the Firebase iOS OAuth client ID before building the iPhone app.");
    }

    await SocialLogin.initialize({
      google: {
        webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
        iOSClientId: GOOGLE_IOS_CLIENT_ID || undefined,
        iOSServerClientId: GOOGLE_IOS_SERVER_CLIENT_ID || undefined,
        mode: "online",
      },
    });
  })().catch((error) => {
    nativeGoogleInitPromise = null;
    throw error;
  });

  return nativeGoogleInitPromise;
}

async function ensureNativeAppleLoginInitialized() {
  if (!Capacitor.isNativePlatform()) return;
  if (nativeAppleInitPromise) return nativeAppleInitPromise;

  nativeAppleInitPromise = (async () => {
    if (Capacitor.getPlatform() !== "ios") {
      throw new Error("Apple sign-in is only available in the iPhone app.");
    }

    await SocialLogin.initialize({
      apple: {
        useProperTokenExchange: false,
      },
    });
  })().catch((error) => {
    nativeAppleInitPromise = null;
    throw error;
  });

  return nativeAppleInitPromise;
}

async function getNativeGoogleCredential() {
  await ensureNativeGoogleLoginInitialized();

  // Android already gets the default Google identity scopes from the plugin.
  // Passing custom scopes here triggers the plugin's extra authorization path.
  const response = await SocialLogin.login({
    provider: "google",
    options: {
      scopes: ["email", "profile", "openid"],
      forcePrompt: true,
    },
  });

  const providerResult = response?.result;
  const idToken = getSocialLoginIdToken(providerResult);
  if (!idToken) {
    throw new Error("Google sign-in did not return an ID token.");
  }

  return GoogleAuthProvider.credential(idToken);
}

async function getNativeAppleCredential() {
  await ensureNativeAppleLoginInitialized();

  const response = await SocialLogin.login({
    provider: "apple",
    options: {
      scopes: ["name", "email"],
    },
  });

  const providerResult = response?.result;
  const idToken = getSocialLoginIdToken(providerResult);
  if (!idToken) {
    throw new Error("Apple sign-in did not return an ID token.");
  }

  // nonce is optional but improves security if the plugin returns one
  const nonce = (providerResult as any)?.nonce ?? undefined;
  return appleProvider.credential({ idToken, rawNonce: nonce });
}

async function clearNativeGoogleSession() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await SocialLogin.logout({ provider: "google" });
  } catch (error) {
    console.warn("Native Google session cleanup failed", error);
  }
}

async function clearNativeAppleSession() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await SocialLogin.logout({ provider: "apple" });
  } catch (error) {
    console.warn("Native Apple session cleanup failed", error);
  }
}

async function clearNativeSocialSessions() {
  await Promise.all([
    clearNativeGoogleSession(),
    clearNativeAppleSession(),
  ]);
}

// Error Handling Spec for Firestore Operations
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Auth Functions

async function ensureUserProfile(user: FirebaseUser) {
  try {
    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);
    const existingProfile = userDoc.exists() ? (userDoc.data() as Partial<UserProfile>) : null;
    const createdAt =
      typeof existingProfile?.createdAt === "string" && existingProfile.createdAt.trim()
        ? existingProfile.createdAt
        : new Date().toISOString();
    const baseProfile = {
      email: user.email,
      tier: existingProfile?.tier === "pay-as-you-use" || existingProfile?.tier === "pro" || existingProfile?.tier === "premium" ? existingProfile.tier : "free",
      createdAt,
    };

    if (!userDoc.exists()) {
      await setDoc(userRef, baseProfile, { merge: true });
      return;
    }

    const syncPatch: Record<string, unknown> = {};

    if (existingProfile.email !== user.email) syncPatch.email = user.email;
    if (existingProfile.createdAt !== createdAt) syncPatch.createdAt = createdAt;
    if (!existingProfile.tier) syncPatch.tier = "free";

    if (Object.keys(syncPatch).length) {
      await setDoc(userRef, syncPatch, { merge: true });
    }
  } catch (error) {
    console.error("Failed to sync user profile after auth", error);
  }
}

export async function completeGoogleRedirectIfPresent() {
  try {
    localStorage.removeItem("chromancy_google_signin_pending");
  } catch (error) {
    console.warn("Could not clear pending Google sign-in state", error);
  }
  return null;
}
export async function loginWithGoogle() {
  const isNativeApp = Capacitor.isNativePlatform();

  await ensureAuthPersistenceReady();

  if (isNativeApp) {
    try {
      const credential = await getNativeGoogleCredential();
      const result = await signInWithCredential(auth, credential);
      await ensureUserProfile(result.user);
      localStorage.removeItem("chromancy_google_signin_pending");
      return result.user;
    } catch (error) {
      localStorage.removeItem("chromancy_google_signin_pending");
      if (!isUserCancelledAuth(error)) {
        console.error("Native Google login failed", error);
      }
      throw error;
    }
  }

  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(result.user);
  localStorage.removeItem("chromancy_google_signin_pending");
  return result.user;
}

export async function loginWithApple() {
  const isNativeApp = Capacitor.isNativePlatform();

  await ensureAuthPersistenceReady();

  if (isNativeApp) {
    try {
      const credential = await getNativeAppleCredential();
      const result = await signInWithCredential(auth, credential);
      await ensureUserProfile(result.user);
      return result.user;
    } catch (error) {
      if (!isUserCancelledAuth(error)) {
        console.error("Native Apple login failed", error);
      }
      throw error;
    }
  }

  const result = await signInWithPopup(auth, appleProvider);
  await ensureUserProfile(result.user);
  return result.user;
}

export async function loginWithEmail(email: string, password: string) {
  try {
    await ensureAuthPersistenceReady();
    const result = await signInWithEmailAndPassword(auth, email, password);
    await ensureUserProfile(result.user);
    return result.user;
  } catch (error) {
    console.error("Email login failed", error);
    throw error;
  }
}

export async function createAccountWithEmail(email: string, password: string, displayName: string) {
  try {
    await ensureAuthPersistenceReady();
    const result = await createUserWithEmailAndPassword(auth, email, password);

    if (displayName.trim()) {
      await updateProfile(result.user, { displayName: displayName.trim() });
    }

    await ensureUserProfile({
      ...result.user,
      displayName: displayName.trim() || result.user.displayName,
    } as FirebaseUser);

    return result.user;
  } catch (error) {
    console.error("Create account failed", error);
    throw error;
  }
}


export async function sendForgotPasswordEmail(email: string) {
  try {
    await sendPasswordResetEmail(auth, email.trim(), {
      url: "https://chromancy.online",
      handleCodeInApp: false,
    });
  } catch (error) {
    console.error("Password reset failed", error);
    throw error;
  }
}

export async function logout() {
  try {
    await clearNativeSocialSessions();
    await signOut(auth);
    clearClientSensitiveState();
  } catch (error) {
    console.error("Logout failed", error);
    throw error;
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    return userDoc.exists() ? normaliseUserProfile(uid, userDoc.data() as Partial<UserProfile>) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    return null;
  }
}

export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
  try {
    if (auth.currentUser?.uid === uid) {
      const authPatch: { displayName?: string | null; photoURL?: string | null } = {};
      if ("displayName" in updates) authPatch.displayName = updates.displayName ?? null;
      if ("photoURL" in updates) authPatch.photoURL = updates.photoURL ?? null;
      if (Object.keys(authPatch).length) {
        await updateProfile(auth.currentUser, authPatch);
      }
    }

    const firestorePatch: Record<string, unknown> = {};
    if ("email" in updates) firestorePatch.email = updates.email ?? auth.currentUser?.email ?? null;
    if ("createdAt" in updates && typeof updates.createdAt === "string" && updates.createdAt.trim()) firestorePatch.createdAt = updates.createdAt;

    if (!Object.keys(firestorePatch).length) {
      return;
    }

    const userRef = doc(db, "users", uid);
    await setDoc(userRef, firestorePatch, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}


export function subscribeToUserProfile(uid: string, callback: (profile: UserProfile | null) => void) {
  return onSnapshot(doc(db, "users", uid), (snapshot) => {
    callback(snapshot.exists() ? normaliseUserProfile(uid, snapshot.data() as Partial<UserProfile>) : null);
  }, (error) => {
    console.error("User profile subscription failed", error);
    callback(null);
  });
}

async function reauthenticateBeforeDelete(user: FirebaseUser, currentPassword?: string) {
  const providerIds = user.providerData.map((provider) => provider.providerId);

  if (providerIds.includes('password')) {
    if (!user.email) throw new Error('Your account email is missing. Please sign in again and try once more.');
    if (!currentPassword?.trim()) throw new Error('Enter your current password to delete this account.');
    const credential = EmailAuthProvider.credential(user.email, currentPassword.trim());
    await reauthenticateWithCredential(user, credential);
    return;
  }

  if (providerIds.includes('google.com')) {
    if (Capacitor.isNativePlatform()) {
      const credential = await getNativeGoogleCredential();
      await reauthenticateWithCredential(user, credential);
      return;
    }

    await reauthenticateWithPopup(user, googleProvider);
  }

  if (providerIds.includes('apple.com')) {
    if (Capacitor.isNativePlatform()) {
      const credential = await getNativeAppleCredential();
      await reauthenticateWithCredential(user, credential);
      return;
    }

    await reauthenticateWithPopup(user, appleProvider);
  }
}

async function purgeServerAccountData(uid: string, idToken?: string | null) {
  const response = await fetch(buildApiUrl("/api/account/purge"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    cache: "no-store",
    body: JSON.stringify({ uid }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Server-side account purge failed.");
  }
}

async function deleteServerAccount(uid: string, idToken?: string | null) {
  const response = await fetch(buildApiUrl("/api/account/delete"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    cache: "no-store",
    body: JSON.stringify({ uid }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Server-side account deletion failed.");
  }
}

async function deleteFirebaseAuthAccount(user: FirebaseUser, idTokenHint?: string | null) {
  const apiKey = typeof firebaseConfig?.apiKey === "string" ? firebaseConfig.apiKey.trim() : "";
  const deleteWithSdk = async () => {
    try {
      await deleteUser(user);
    } catch (error: any) {
      if (error?.code === "auth/user-not-found" || error?.code === "auth/user-token-expired") return;
      throw error;
    }
  };

  const idToken = idTokenHint || await user.getIdToken(true);

  if (apiKey) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      cache: "no-store",
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.error?.message || "Firebase account deletion failed.";
      if (message === "USER_NOT_FOUND") return;
      if (message === "TOKEN_EXPIRED" || message === "INVALID_ID_TOKEN") {
        await deleteWithSdk();
        return;
      }
      throw new Error(message);
    }
    return;
  }

  await deleteWithSdk();
}

export async function syncBundleWallet(uid: string, bundleWallet: BundleWallet) {
  void uid;
  void bundleWallet;
}

export async function deleteCurrentUserAccount(currentPassword?: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in.');

  await reauthenticateBeforeDelete(user, currentPassword);
  const freshIdToken = await user.getIdToken(true).catch(() => null);
  const userProjects = await getDocs(query(collection(db, 'projects'), where('userId', '==', user.uid)));
  await Promise.all(userProjects.docs.map((projectDoc) => deleteDoc(projectDoc.ref)));
  await deleteDoc(doc(db, 'users', user.uid)).catch(() => undefined);
  await purgeServerAccountData(user.uid, freshIdToken).catch((error) => {
    console.warn("Server-side account data purge failed", error);
  });
  await deleteServerAccount(user.uid, freshIdToken).catch((serverDeleteError) => {
    console.warn("Server-side account deletion failed; deleting auth account directly on the client.", serverDeleteError);
  });
  await deleteFirebaseAuthAccount(user, freshIdToken);

  await clearLocalHistory().catch(() => undefined);
  clearClientSensitiveState();
  await clearNativeSocialSessions().catch(() => undefined);
  await signOut(auth).catch(() => undefined);
}

// Project Functions
export async function createProject(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) {
  try {
    const projectRef = doc(collection(db, "projects"));
    const newProject: Project = {
      ...project,
      id: projectRef.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setDoc(projectRef, newProject);
    return newProject;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, "projects");
  }
}

export async function getProjects(userId: string) {
  try {
    const q = query(collection(db, "projects"), where("userId", "==", userId));
    const projects: Project[] = [];
    return new Promise<Project[]>((resolve, reject) => {
      onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => doc.data() as Project);
        resolve(items.sort((a, b) => b.updatedAt - a.updatedAt));
      }, (error) => {
        reject(error);
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, "projects");
  }
}

export async function updateProject(projectId: string, updates: Partial<Project>) {
  try {
    const projectRef = doc(db, "projects", projectId);
    await updateDoc(projectRef, {
      ...updates,
      updatedAt: Date.now(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}`);
  }
}

export async function deleteProject(projectId: string) {
  try {
    await deleteDoc(doc(db, "projects", projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}`);
  }
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

function normaliseUserProfile(uid: string, data: Partial<UserProfile>): UserProfile {
  const currentUser = auth.currentUser;
  return {
    uid,
    email: typeof data.email === "string" ? data.email : currentUser?.email ?? null,
    displayName: currentUser?.displayName ?? null,
    photoURL: currentUser?.photoURL ?? null,
    tier: data.tier === "pay-as-you-use" || data.tier === "pro" || data.tier === "premium" ? data.tier : "free",
    unlockedProjects: Array.isArray(data.unlockedProjects) ? data.unlockedProjects : [],
    bundleWallet: data.bundleWallet,
  };
}

function clearClientSensitiveState() {
  clearDeviceId();
  try {
    sessionStorage.removeItem("chromancy_nav_resume_state_v2");
    sessionStorage.removeItem("chromancy_device_id_session_v1");
  } catch {
    // no-op
  }

  try {
    localStorage.removeItem("chromancy_google_signin_pending");
    localStorage.removeItem("chromancy_subscribe_view");
    localStorage.removeItem("chromancy_bundle_ack_photo");
    localStorage.removeItem("chromancy_bundle_ack_video");
    localStorage.removeItem("chromancy_bundle_ack_design");
    localStorage.removeItem("chromancy_bundle_ack_business");
  } catch {
    // no-op
  }
}


