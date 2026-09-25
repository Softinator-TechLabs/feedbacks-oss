import Foundation

public struct FeedbacksCredential: Codable, Sendable {
    public let token: String
    public let expiresAt: String

    public init(token: String, expiresAt: String) {
        self.token = token
        self.expiresAt = expiresAt
    }
}

public struct FeedbacksViewport: Sendable {
    public let width: Int
    public let height: Int
    public let pixelRatio: Double

    public init(width: Int, height: Int, pixelRatio: Double) {
        self.width = width
        self.height = height
        self.pixelRatio = pixelRatio
    }
}

public struct FeedbacksThread: Decodable, Sendable {
    public let id: String
    public let revision: Int

    public init(id: String, revision: Int) {
        self.id = id
        self.revision = revision
    }
}

public struct FeedbacksUpload: Sendable {
    public let assetId: String
    public let thread: FeedbacksThread
}

public struct FeedbacksPairing: Sendable {
    public let pairingId: String
    public let deviceSecret: String
    public let expiresAt: String
    public let intervalSeconds: Int
    public let approvalURL: URL
}

public enum FeedbacksPairingState: Sendable {
    case pending
    case approved(FeedbacksCredential)
}

public struct FeedbacksAPIError: Error, Sendable {
    public let code: String
    public let message: String
    public let status: Int
}

public enum FeedbacksClientError: Error {
    case invalidServerURL
    case invalidScreenURL
    case invalidApprovalPath
    case invalidScreenshotSize
    case invalidResponse
}

/// The host app owns the draft, screenshot preview, redaction and credential lifecycle.
/// No request is retried automatically after an uncertain network result.
public final class FeedbacksClient: @unchecked Sendable {
    private let serverURL: URL
    private let session: URLSession

    public init(serverURL: URL, session: URLSession? = nil, allowInsecureLocalhost: Bool = false) throws {
        let host = serverURL.host?.lowercased()
        let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]"
        guard (serverURL.scheme == "https" || (allowInsecureLocalhost && local && serverURL.scheme == "http")),
              host != nil, serverURL.user == nil, serverURL.password == nil,
              serverURL.query == nil, serverURL.fragment == nil,
              serverURL.path.isEmpty || serverURL.path == "/" else {
            throw FeedbacksClientError.invalidServerURL
        }
        self.serverURL = serverURL
        self.session = session ?? URLSession(configuration: .ephemeral,
                                             delegate: FeedbacksRedirectBlocker(), delegateQueue: nil)
    }

    public func startPairing(name: String) async throws -> FeedbacksPairing {
        let result: PairingData = try await post("pairing.request", ["name": name])
        guard result.approvalPath.hasPrefix("/pair?"),
              let approvalURL = URL(string: result.approvalPath, relativeTo: serverURL)?.absoluteURL,
              approvalURL.host == serverURL.host,
              approvalURL.scheme == serverURL.scheme else {
            throw FeedbacksClientError.invalidApprovalPath
        }
        return FeedbacksPairing(pairingId: result.pairingId, deviceSecret: result.deviceSecret,
                                expiresAt: result.expiresAt, intervalSeconds: result.intervalSeconds,
                                approvalURL: approvalURL)
    }

    public func pollPairing(_ pairing: FeedbacksPairing) async throws -> FeedbacksPairingState {
        let result: PollData = try await post("pairing.poll", [
            "pairingId": pairing.pairingId,
            "deviceSecret": pairing.deviceSecret
        ])
        if result.status == "pending" { return .pending }
        guard result.status == "approved", let token = result.token, let expiresAt = result.expiresAt else {
            throw FeedbacksClientError.invalidResponse
        }
        return .approved(FeedbacksCredential(token: token, expiresAt: expiresAt))
    }

    public func listProjects(credential: FeedbacksCredential) async throws -> [FeedbacksProject] {
        let result: ProjectListData = try await post("projects.list", [:], credential: credential)
        return result.items
    }

    public func createFeedback(credential: FeedbacksCredential, projectId: String, body: String,
                               screenURL: URL, title: String, viewport: FeedbacksViewport,
                               idempotencyKey: String) async throws -> FeedbacksThread {
        let safeURL = try sanitizedScreenURL(screenURL)
        return try await post("threads.create", [
            "projectId": projectId,
            "body": body,
            "context": [
                "url": safeURL,
                "title": title,
                "viewport": ["width": viewport.width, "height": viewport.height],
                "devicePixelRatio": viewport.pixelRatio
            ],
            "idempotencyKey": idempotencyKey
        ], credential: credential)
    }

    private func sanitizedScreenURL(_ input: URL) throws -> String {
        guard var components = URLComponents(url: input, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
              components.host != nil, components.user == nil, components.password == nil else {
            throw FeedbacksClientError.invalidScreenURL
        }
        components.fragment = nil
        components.queryItems = components.queryItems?.filter {
            $0.name.range(of: "token|secret|password|passwd|auth|session|cookie|email|key|code|signature|jwt|credential",
                          options: [.regularExpression, .caseInsensitive]) == nil
        }
        guard let result = components.url?.absoluteString else { throw FeedbacksClientError.invalidScreenURL }
        return result
    }

    public func uploadScreenshot(credential: FeedbacksCredential, thread: FeedbacksThread,
                                 imageData: Data, idempotencyKey: String) async throws -> FeedbacksUpload {
        guard !imageData.isEmpty && imageData.count <= 10 * 1024 * 1024 else {
            throw FeedbacksClientError.invalidScreenshotSize
        }
        let result: UploadData = try await post("assets.upload", [
            "threadId": thread.id,
            "revision": thread.revision,
            "imageBase64": imageData.base64EncodedString(),
            "rendition": "screenshot",
            "idempotencyKey": idempotencyKey
        ], credential: credential)
        return FeedbacksUpload(assetId: result.asset.id, thread: result.thread)
    }

    private func post<T: Decodable>(_ operation: String, _ body: [String: Any],
                                     credential: FeedbacksCredential? = nil) async throws -> T {
        var request = URLRequest(url: serverURL.appendingPathComponent("api").appendingPathComponent(operation))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let credential { request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw FeedbacksClientError.invalidResponse }
        let envelope = try JSONDecoder().decode(Envelope<T>.self, from: data)
        if let error = envelope.error {
            throw FeedbacksAPIError(code: error.code, message: error.message, status: response.statusCode)
        }
        guard (200..<300).contains(response.statusCode), envelope.ok, let value = envelope.data else {
            throw FeedbacksClientError.invalidResponse
        }
        return value
    }
}

private final class FeedbacksRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public struct FeedbacksProject: Decodable, Sendable {
    public let id: String
    public let name: String
    public let origins: [String]
    public let permissions: Permissions

    public struct Permissions: Decodable, Sendable {
        public let canWrite: Bool
    }
}

private struct PairingData: Decodable {
    let pairingId: String
    let deviceSecret: String
    let expiresAt: String
    let intervalSeconds: Int
    let approvalPath: String
}

private struct PollData: Decodable {
    let status: String
    let token: String?
    let expiresAt: String?
}

private struct ProjectListData: Decodable {
    let items: [FeedbacksProject]
}

private struct UploadData: Decodable {
    let asset: Asset
    let thread: FeedbacksThread
    struct Asset: Decodable { let id: String }
}

private struct Envelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: APIErrorData?
}

private struct APIErrorData: Decodable {
    let code: String
    let message: String
}
