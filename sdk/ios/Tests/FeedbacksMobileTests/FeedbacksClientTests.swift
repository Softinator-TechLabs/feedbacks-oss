import Foundation
import XCTest
@testable import FeedbacksMobile

final class FeedbacksClientTests: XCTestCase {
    func testPairingRequiresApprovalBeforeReturningDeviceToken() async throws {
        let session = makeSession { request in
            switch request.url!.path {
            case "/api/pairing.request":
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                XCTAssertEqual(try json(request)["name"] as? String, "iPhone QA")
                return (200, #"{"ok":true,"data":{"pairingId":"00000000-0000-4000-8000-000000000001","deviceSecret":"device-secret-long-enough","expiresAt":"2026-09-25T10:00:00Z","intervalSeconds":3,"approvalPath":"/pair?pairingId=00000000-0000-4000-8000-000000000001"}}"#)
            case "/api/pairing.poll":
                XCTAssertEqual(try json(request)["deviceSecret"] as? String, "device-secret-long-enough")
                return (200, #"{"ok":true,"data":{"status":"approved","token":"new-device-token","expiresAt":"2026-10-25T10:00:00Z","kind":"extension"}}"#)
            default: XCTFail("Unexpected route"); return (404, "{}")
            }
        }
        let client = try FeedbacksClient(serverURL: URL(string: "https://feedback.example.com")!, session: session)
        let pairing = try await client.startPairing(name: "iPhone QA")
        XCTAssertEqual(pairing.approvalURL.absoluteString, "https://feedback.example.com/pair?pairingId=00000000-0000-4000-8000-000000000001")
        let state = try await client.pollPairing(pairing)
        guard case .approved(let credential) = state else { return XCTFail("Expected approved device") }
        XCTAssertEqual(credential.token, "new-device-token")
    }

    func testCreateAndScreenshotUploadUseScopedBearerAndSeparateIdempotencyKeys() async throws {
        let session = makeSession { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer paired-token")
            switch request.url!.path {
            case "/api/threads.create":
                let body = try json(request)
                XCTAssertEqual(body["idempotencyKey"] as? String, "create-key-123")
                let context = try XCTUnwrap(body["context"] as? [String: Any])
                XCTAssertEqual(context["url"] as? String, "https://app.example.com/screens/cart?variant=b")
                XCTAssertEqual((context["viewport"] as? [String: Int])?["width"], 390)
                XCTAssertEqual(context["devicePixelRatio"] as? Int, 3)
                return (200, #"{"ok":true,"data":{"id":"00000000-0000-4000-8000-000000000002","revision":1}}"#)
            case "/api/assets.upload":
                let body = try json(request)
                XCTAssertEqual(body["idempotencyKey"] as? String, "upload-key-123")
                XCTAssertEqual(body["revision"] as? Int, 1)
                XCTAssertEqual(body["imageBase64"] as? String, Data([0x89, 0x50, 0x4e, 0x47]).base64EncodedString())
                return (200, #"{"ok":true,"data":{"asset":{"id":"00000000-0000-4000-8000-000000000003"},"thread":{"id":"00000000-0000-4000-8000-000000000002","revision":2}}}"#)
            default: XCTFail("Unexpected route"); return (404, "{}")
            }
        }
        let client = try FeedbacksClient(serverURL: URL(string: "https://feedback.example.com")!, session: session)
        let credential = FeedbacksCredential(token: "paired-token", expiresAt: "2026-10-25T10:00:00Z")
        let receipt = try await client.createFeedback(
            credential: credential,
            projectId: "00000000-0000-4000-8000-000000000010",
            body: "Cart button is hard to find",
            screenURL: URL(string: "https://app.example.com/screens/cart?session=secret&variant=b#private")!,
            title: "Cart",
            viewport: .init(width: 390, height: 844, pixelRatio: 3),
            idempotencyKey: "create-key-123"
        )
        XCTAssertEqual(receipt.revision, 1)
        let upload = try await client.uploadScreenshot(
            credential: credential,
            thread: receipt,
            imageData: Data([0x89, 0x50, 0x4e, 0x47]),
            idempotencyKey: "upload-key-123"
        )
        XCTAssertEqual(upload.assetId, "00000000-0000-4000-8000-000000000003")
        XCTAssertEqual(upload.thread.revision, 2)
    }

    func testConflictReturnsCodeWithoutAutomaticSecondWrite() async throws {
        let session = makeSession { _ in
            (409, #"{"ok":false,"error":{"code":"CONFLICT","message":"Feedback changed; reload before retrying"}}"#)
        }
        let client = try FeedbacksClient(serverURL: URL(string: "https://feedback.example.com")!, session: session)
        do {
            _ = try await client.uploadScreenshot(
                credential: .init(token: "paired-token", expiresAt: "2026-10-25T10:00:00Z"),
                thread: .init(id: "00000000-0000-4000-8000-000000000002", revision: 1),
                imageData: Data([1, 2, 3]),
                idempotencyKey: "upload-key-123"
            )
            XCTFail("Expected server conflict")
        } catch let error as FeedbacksAPIError {
            XCTAssertEqual(error.status, 409)
            XCTAssertEqual(error.code, "CONFLICT")
        }
    }

    func testRejectsUnencryptedRemoteServer() {
        XCTAssertThrowsError(try FeedbacksClient(serverURL: URL(string: "http://feedback.example.com")!))
    }
}

private final class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private func makeSession(_ handler: @escaping (URLRequest) throws -> (Int, String)) -> URLSession {
    MockURLProtocol.handler = handler
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    return URLSession(configuration: config)
}

private func json(_ request: URLRequest) throws -> [String: Any] {
    let data: Data
    if let body = request.httpBody { data = body }
    else {
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var bytes = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&chunk, maxLength: chunk.count)
            if count <= 0 { break }
            bytes.append(contentsOf: chunk[..<count])
        }
        data = bytes
    }
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}
