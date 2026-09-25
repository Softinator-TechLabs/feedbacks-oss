import Foundation
import FeedbacksMobile

private enum Check: Error { case failed(String) }

private final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var requests: [URLRequest] = []
    nonisolated(unsafe) static var requestBodies: [Data] = []
    nonisolated(unsafe) static var responses: [String: String] = [:]
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        Self.requestBodies.append(bodyData(request))
        let body = Self.responses[request.url!.path] ?? #"{"ok":false,"error":{"code":"NOT_FOUND","message":"Missing fixture"}}"#
        let status = body.contains("Missing fixture") ? 404 : 200
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main struct Smoke {
    static func main() async throws {
        StubProtocol.responses = [
            "/api/pairing.request": #"{"ok":true,"data":{"pairingId":"00000000-0000-4000-8000-000000000001","deviceSecret":"device-secret-long-enough","expiresAt":"2026-09-25T10:00:00Z","intervalSeconds":3,"approvalPath":"/pair?pairingId=00000000-0000-4000-8000-000000000001"}}"#,
            "/api/pairing.poll": #"{"ok":true,"data":{"status":"approved","token":"paired-token","expiresAt":"2026-10-25T10:00:00Z"}}"#,
            "/api/threads.create": #"{"ok":true,"data":{"id":"00000000-0000-4000-8000-000000000002","revision":1}}"#,
            "/api/assets.upload": #"{"ok":true,"data":{"asset":{"id":"00000000-0000-4000-8000-000000000003"},"thread":{"id":"00000000-0000-4000-8000-000000000002","revision":2}}}"#
        ]
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let client = try FeedbacksClient(serverURL: URL(string: "https://feedback.example.test")!, session: URLSession(configuration: config))
        let pairing = try await client.startPairing(name: "iPhone QA")
        guard pairing.approvalURL.host == "feedback.example.test" else { throw Check.failed("approval host") }
        guard case .approved(let credential) = try await client.pollPairing(pairing) else { throw Check.failed("pairing") }
        let thread = try await client.createFeedback(credential: credential,
            projectId: "00000000-0000-4000-8000-000000000010", body: "Cart button is hard to find",
            screenURL: URL(string: "https://app.example.test/cart?token=secret&variant=b#private")!, title: "Cart",
            viewport: .init(width: 390, height: 844, pixelRatio: 3), idempotencyKey: "create-key-123")
        let upload = try await client.uploadScreenshot(credential: credential, thread: thread,
            imageData: Data([0x89, 0x50, 0x4e, 0x47]), idempotencyKey: "upload-key-123")
        guard upload.thread.revision == 2, StubProtocol.requests.count == 4 else { throw Check.failed("submission") }
        guard StubProtocol.requests[0].value(forHTTPHeaderField: "Authorization") == nil,
              StubProtocol.requests[2].value(forHTTPHeaderField: "Authorization") == "Bearer paired-token" else {
            throw Check.failed("token boundary")
        }
        let createBody = try JSONSerialization.jsonObject(with: StubProtocol.requestBodies[2]) as! [String: Any]
        guard createBody["idempotencyKey"] as? String == "create-key-123",
              (createBody["context"] as? [String: Any])?["url"] as? String == "https://app.example.test/cart?variant=b" else {
            throw Check.failed("context")
        }
        let uploadBody = try JSONSerialization.jsonObject(with: StubProtocol.requestBodies[3]) as! [String: Any]
        guard uploadBody["idempotencyKey"] as? String == "upload-key-123",
              uploadBody["imageBase64"] as? String == Data([0x89, 0x50, 0x4e, 0x47]).base64EncodedString() else {
            throw Check.failed("screenshot")
        }
        print("Swift mobile client smoke passed: pairing, bearer boundary, create and screenshot upload")
    }
}

private func bodyData(_ request: URLRequest) -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var bytes = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
        let count = stream.read(&chunk, maxLength: chunk.count)
        if count <= 0 { break }
        bytes.append(contentsOf: chunk[..<count])
    }
    return bytes
}
