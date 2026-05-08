import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

function read(relativePath, optional = false) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    if (!optional) failures.push(`Missing required file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

const pkg = JSON.parse(read("package.json") || "{}");
const server = read("server.ts");
const envProduction = read(".env.production", true);
const capacitorConfig = read("capacitor.config.ts", true);
const toolConfig = read("src/lib/toolConfig.ts", true);
const androidManifest = read("android/app/src/main/AndroidManifest.xml", true);
const iosInfoPlist = read("ios/App/App/Info.plist", true);

expect(Boolean(pkg.dependencies?.helmet), "Helmet must stay installed as a production dependency.");
expect(server.includes("app.use(helmet("), "Server must apply Helmet security headers.");
expect(server.includes("REQUIRE_REVENUECAT_WEBHOOK_SECRET"), "RevenueCat webhook secret enforcement is missing.");
expect(server.includes("!REVENUECAT_WEBHOOK_SECRET && REQUIRE_REVENUECAT_WEBHOOK_SECRET"), "RevenueCat webhook must reject production traffic when the webhook secret is missing.");
expect(server.includes("FREE_TEST_ALLOWLIST_CONFIGURED"), "Free-test mode must require a UID/email allowlist.");
expect(server.includes("Free-test bypass was denied"), "Free-test mode must deny bypass when no allowlist is configured.");
expect(!server.includes('app.post("/api/checkout"'), "Remove stale /api/checkout dummy endpoint.");
expect(server.includes("/api/client-crash"), "Crash logging endpoint must be wired if crash logs are declared.");
expect(toolConfig.includes('internalId: "create"') && toolConfig.includes("pricingTier: \"tier3\"") && toolConfig.includes("proCreditCost: 3"), "CREATE must remain R39 / 3 subscription credits.");
expect(capacitorConfig.includes("appId: 'com.chromancy.app'") || capacitorConfig.includes('appId: "com.chromancy.app"'), "Capacitor appId must remain com.chromancy.app.");

if (androidManifest) {
  expect(androidManifest.includes('android:allowBackup="false"'), "Android backup must be disabled for local media/history/cache.");
  expect(androidManifest.includes('android:fullBackupContent="false"'), "Android full backup content must be disabled or strictly excluded.");
}

if (iosInfoPlist) {
  expect(iosInfoPlist.includes("NSCameraUsageDescription"), "iOS camera permission usage description is required.");
  expect(iosInfoPlist.includes("NSPhotoLibraryUsageDescription"), "iOS photo library permission usage description is required.");
  expect(iosInfoPlist.includes("NSPhotoLibraryAddUsageDescription"), "iOS photo save permission usage description is required.");
  warn(
    capacitorConfig.includes("apple: true") || !capacitorConfig.includes("google: true"),
    "If Google sign-in is enabled in the iOS UI, enable Sign in with Apple before App Store review.",
  );
}

if (envProduction) {
  expect(envProduction.includes("CHROMANCY_FREE_TEST_MODE=false"), "Production free-test mode must remain false unless an allowlist is configured.");
  expect(envProduction.includes("VITE_CHROMANCY_FREE_TEST_MODE=false"), "Frontend production free-test mode must remain false.");
  expect(envProduction.includes("CHROMANCY_CRASH_LOGS_ENABLED=true"), "Crash logging is selected in policy; production backend crash logs should be enabled.");
  expect(envProduction.includes("VITE_CHROMANCY_CRASH_LOGS_ENABLED=true"), "Crash logging is selected in policy; production app crash logs should be enabled.");
  warn(!envProduction.includes("change-this-revenuecat-webhook-secret"), "Set the real RevenueCat webhook secret in production secrets, not the placeholder.");
}

if (failures.length) {
  console.error("Release QA blockers:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  if (warnings.length) {
    console.warn("\nWarnings:");
    warnings.forEach((warning) => console.warn(`- ${warning}`));
  }
  process.exit(1);
}

console.log("Static release QA checks passed.");
if (warnings.length) {
  console.warn("Warnings:");
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}
