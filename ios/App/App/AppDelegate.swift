import UIKit
import Capacitor
import Photos
import UniformTypeIdentifiers

#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        #if canImport(GoogleSignIn)
        if GIDSignIn.sharedInstance.handle(url) {
            return true
        }
        #endif

        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

@objc(ChromancyBridgeViewController)
class ChromancyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeMediaStorePlugin())
        bridge?.registerPluginInstance(BeamScreenPlugin())
    }
}

enum NativeMediaStoreError: LocalizedError {
    case missingFileData
    case missingFileName
    case missingSession
    case invalidBase64
    case unavailableSession
    case failedToCreateTempFile
    case failedToOpenTempFile
    case failedToCreateAsset
    case photoPermissionDenied
    case failedToLocateDocuments
    case failedToPersistFile

    var errorDescription: String? {
        switch self {
        case .missingFileData:
            return "Missing file data."
        case .missingFileName:
            return "Missing file name."
        case .missingSession:
            return "Missing file save session."
        case .invalidBase64:
            return "Invalid file data."
        case .unavailableSession:
            return "File save session is no longer available."
        case .failedToCreateTempFile:
            return "Unable to prepare destination file."
        case .failedToOpenTempFile:
            return "Unable to open destination file."
        case .failedToCreateAsset:
            return "Unable to save file to the Photos library."
        case .photoPermissionDenied:
            return "Photo library permission was denied."
        case .failedToLocateDocuments:
            return "Unable to locate the app documents folder."
        case .failedToPersistFile:
            return "Unable to save file."
        }
    }
}

final class NativeMediaPendingSave {
    let fileURL: URL
    let displayName: String
    let relativePath: String
    let mimeType: String
    private let handle: FileHandle
    private var isClosed = false

    init(fileURL: URL, displayName: String, relativePath: String, mimeType: String, handle: FileHandle) {
        self.fileURL = fileURL
        self.displayName = displayName
        self.relativePath = relativePath
        self.mimeType = mimeType
        self.handle = handle
    }

    func append(_ data: Data) throws {
        try handle.write(contentsOf: data)
    }

    func closeForWriting() {
        guard !isClosed else { return }
        handle.synchronizeFile()
        handle.closeFile()
        isClosed = true
    }
}

@objc(NativeMediaStorePlugin)
class NativeMediaStorePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeMediaStorePlugin"
    let jsName = "NativeMediaStore"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abortFile", returnType: CAPPluginReturnPromise)
    ]

    private let storageQueue = DispatchQueue(label: "com.chromancy.nativeMediaStore")
    private var pendingSaves: [String: NativeMediaPendingSave] = [:]

    @objc func saveFile(_ call: CAPPluginCall) {
        guard let base64Data = call.getString("base64Data"), !base64Data.isEmpty else {
            call.reject(NativeMediaStoreError.missingFileData.localizedDescription)
            return
        }

        guard let fileName = call.getString("fileName")?.trimmingCharacters(in: .whitespacesAndNewlines), !fileName.isEmpty else {
            call.reject(NativeMediaStoreError.missingFileName.localizedDescription)
            return
        }

        let mimeType = call.getString("mimeType") ?? "application/octet-stream"

        Task {
            do {
                let data = try decodeBase64(base64Data)
                let pendingSave = try createPendingSave(fileName: fileName, mimeType: mimeType)
                do {
                    try pendingSave.append(data)
                    let result = try await finalizePendingSave(pendingSave)
                    call.resolve(result)
                } catch {
                    abortPendingSave(pendingSave)
                    call.reject(error.localizedDescription, nil, error)
                }
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    @objc func beginFile(_ call: CAPPluginCall) {
        guard let fileName = call.getString("fileName")?.trimmingCharacters(in: .whitespacesAndNewlines), !fileName.isEmpty else {
            call.reject(NativeMediaStoreError.missingFileName.localizedDescription)
            return
        }

        let mimeType = call.getString("mimeType") ?? "application/octet-stream"

        do {
            let pendingSave = try createPendingSave(fileName: fileName, mimeType: mimeType)
            let sessionId = UUID().uuidString
            storageQueue.sync {
                pendingSaves[sessionId] = pendingSave
            }
            call.resolve(["sessionId": sessionId])
        } catch {
            call.reject(error.localizedDescription, nil, error)
        }
    }

    @objc func appendChunk(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"), !sessionId.isEmpty else {
            call.reject(NativeMediaStoreError.missingSession.localizedDescription)
            return
        }

        guard let base64Chunk = call.getString("base64Chunk"), !base64Chunk.isEmpty else {
            call.reject(NativeMediaStoreError.missingFileData.localizedDescription)
            return
        }

        guard let pendingSave = storageQueue.sync(execute: { pendingSaves[sessionId] }) else {
            call.reject(NativeMediaStoreError.unavailableSession.localizedDescription)
            return
        }

        do {
            let data = try decodeBase64(base64Chunk)
            try pendingSave.append(data)
            call.resolve()
        } catch {
            storageQueue.sync {
                pendingSaves.removeValue(forKey: sessionId)
            }
            abortPendingSave(pendingSave)
            call.reject(error.localizedDescription, nil, error)
        }
    }

    @objc func finishFile(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"), !sessionId.isEmpty else {
            call.reject(NativeMediaStoreError.missingSession.localizedDescription)
            return
        }

        guard let pendingSave = storageQueue.sync(execute: { pendingSaves.removeValue(forKey: sessionId) }) else {
            call.reject(NativeMediaStoreError.unavailableSession.localizedDescription)
            return
        }

        Task {
            do {
                let result = try await finalizePendingSave(pendingSave)
                call.resolve(result)
            } catch {
                abortPendingSave(pendingSave)
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    @objc func abortFile(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"), !sessionId.isEmpty else {
            call.resolve()
            return
        }

        let pendingSave = storageQueue.sync { pendingSaves.removeValue(forKey: sessionId) }
        if let pendingSave {
            abortPendingSave(pendingSave)
        }
        call.resolve()
    }

    private func decodeBase64(_ value: String) throws -> Data {
        guard let data = Data(base64Encoded: value, options: [.ignoreUnknownCharacters]) else {
            throw NativeMediaStoreError.invalidBase64
        }
        return data
    }

    private func createPendingSave(fileName: String, mimeType: String) throws -> NativeMediaPendingSave {
        let safeName = ensureExtension(fileName: fileName, mimeType: mimeType)
        let tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("ChromancyPending", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true, attributes: nil)

        let fileURL = uniqueFileURL(in: tempDirectory, fileName: safeName)
        guard FileManager.default.createFile(atPath: fileURL.path, contents: nil) else {
            throw NativeMediaStoreError.failedToCreateTempFile
        }

        do {
            let handle = try FileHandle(forWritingTo: fileURL)
            return NativeMediaPendingSave(
                fileURL: fileURL,
                displayName: safeName,
                relativePath: relativePath(for: mimeType),
                mimeType: mimeType,
                handle: handle
            )
        } catch {
            try? FileManager.default.removeItem(at: fileURL)
            throw NativeMediaStoreError.failedToOpenTempFile
        }
    }

    private func finalizePendingSave(_ pendingSave: NativeMediaPendingSave) async throws -> JSObject {
        pendingSave.closeForWriting()

        let uri: String
        if shouldSaveToPhotoLibrary(mimeType: pendingSave.mimeType) {
            uri = try await persistToPhotoLibrary(pendingSave)
        } else {
            uri = try persistToDocuments(pendingSave)
        }

        var result = JSObject()
        result["uri"] = uri
        result["displayName"] = pendingSave.displayName
        result["relativePath"] = pendingSave.relativePath
        result["mimeType"] = pendingSave.mimeType
        return result
    }

    private func shouldSaveToPhotoLibrary(mimeType: String) -> Bool {
        let lower = mimeType.lowercased()
        return lower.hasPrefix("image/") || lower.hasPrefix("video/")
    }

    private func ensurePhotoLibraryAccess() async throws {
        if #available(iOS 14, *) {
            let current = PHPhotoLibrary.authorizationStatus(for: .addOnly)
            switch current {
            case .authorized, .limited:
                return
            case .notDetermined:
                let status = await withCheckedContinuation { continuation in
                    PHPhotoLibrary.requestAuthorization(for: .addOnly) { nextStatus in
                        continuation.resume(returning: nextStatus)
                    }
                }
                if status == .authorized || status == .limited {
                    return
                }
                throw NativeMediaStoreError.photoPermissionDenied
            default:
                throw NativeMediaStoreError.photoPermissionDenied
            }
        } else {
            let current = PHPhotoLibrary.authorizationStatus()
            switch current {
            case .authorized:
                return
            case .notDetermined:
                let status = await withCheckedContinuation { continuation in
                    PHPhotoLibrary.requestAuthorization { nextStatus in
                        continuation.resume(returning: nextStatus)
                    }
                }
                if status == .authorized {
                    return
                }
                throw NativeMediaStoreError.photoPermissionDenied
            default:
                throw NativeMediaStoreError.photoPermissionDenied
            }
        }
    }

    private func persistToPhotoLibrary(_ pendingSave: NativeMediaPendingSave) async throws -> String {
        try await ensurePhotoLibraryAccess()

        let assetIdentifier: String = try await withCheckedThrowingContinuation { continuation in
            var placeholderIdentifier: String?
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = pendingSave.displayName
                let resourceType: PHAssetResourceType = pendingSave.mimeType.lowercased().hasPrefix("video/") ? .video : .photo
                request.addResource(with: resourceType, fileURL: pendingSave.fileURL, options: options)
                placeholderIdentifier = request.placeholderForCreatedAsset?.localIdentifier
            }, completionHandler: { success, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard success, let placeholderIdentifier else {
                    continuation.resume(throwing: NativeMediaStoreError.failedToCreateAsset)
                    return
                }

                continuation.resume(returning: placeholderIdentifier)
            })
        }

        try? FileManager.default.removeItem(at: pendingSave.fileURL)
        return "ph://\(assetIdentifier)"
    }

    private func persistToDocuments(_ pendingSave: NativeMediaPendingSave) throws -> String {
        guard let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            throw NativeMediaStoreError.failedToLocateDocuments
        }

        let exportDirectory = documentsDirectory.appendingPathComponent("ChromancyExports", isDirectory: true)
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true, attributes: nil)
        let destinationURL = uniqueFileURL(in: exportDirectory, fileName: pendingSave.displayName)

        do {
            try FileManager.default.moveItem(at: pendingSave.fileURL, to: destinationURL)
            return destinationURL.absoluteString
        } catch {
            throw NativeMediaStoreError.failedToPersistFile
        }
    }

    private func abortPendingSave(_ pendingSave: NativeMediaPendingSave) {
        pendingSave.closeForWriting()
        try? FileManager.default.removeItem(at: pendingSave.fileURL)
    }

    private func relativePath(for mimeType: String) -> String {
        let lower = mimeType.lowercased()
        if lower.hasPrefix("image/") {
            return "Photos/Chromancy"
        }
        if lower.hasPrefix("video/") {
            return "Videos/Chromancy"
        }
        return "Documents/ChromancyExports"
    }

    private func ensureExtension(fileName: String, mimeType: String) -> String {
        if fileName.contains(".") {
            return fileName
        }
        if let ext = UTType(mimeType: mimeType)?.preferredFilenameExtension, !ext.isEmpty {
            return fileName + "." + ext
        }
        return fileName
    }

    private func uniqueFileURL(in directory: URL, fileName: String) -> URL {
        let candidate = directory.appendingPathComponent(fileName)
        if !FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }

        let ext = candidate.pathExtension
        let baseName = ext.isEmpty ? fileName : String(fileName.dropLast(ext.count + 1))
        var index = 2
        while true {
            let nextName = ext.isEmpty ? "\(baseName) \(index)" : "\(baseName) \(index).\(ext)"
            let nextURL = directory.appendingPathComponent(nextName)
            if !FileManager.default.fileExists(atPath: nextURL.path) {
                return nextURL
            }
            index += 1
        }
    }
}

@objc(BeamScreenPlugin)
class BeamScreenPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "BeamScreenPlugin"
    let jsName = "BeamScreen"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "captureOriginalBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restoreBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise)
    ]

    private var originalBrightness: CGFloat?

    @objc func captureOriginalBrightness(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.originalBrightness == nil {
                self.originalBrightness = UIScreen.main.brightness
            }
            call.resolve(["brightness": self.originalBrightness ?? UIScreen.main.brightness])
        }
    }

    @objc func setBrightness(_ call: CAPPluginCall) {
        let requested = call.getFloat("brightness")
        guard let requested else {
            call.reject("Missing brightness.")
            return
        }

        DispatchQueue.main.async {
            if self.originalBrightness == nil {
                self.originalBrightness = UIScreen.main.brightness
            }
            let clamped = min(max(CGFloat(requested), 0.08), 1.0)
            UIScreen.main.brightness = clamped
            call.resolve(["brightness": clamped])
        }
    }

    @objc func restoreBrightness(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let restored = self.originalBrightness ?? UIScreen.main.brightness
            UIScreen.main.brightness = restored
            self.originalBrightness = nil
            call.resolve(["brightness": restored])
        }
    }

    @objc func setKeepAwake(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("Missing keep awake state.")
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve()
        }
    }
}

