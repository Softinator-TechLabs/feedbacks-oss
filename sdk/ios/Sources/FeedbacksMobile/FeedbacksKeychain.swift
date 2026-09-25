import Foundation
import Security

/// This-device-only storage for a paired token, keyed by the exact Feedbacks server URL.
public enum FeedbacksKeychain {
    private static let service = "org.feedbacks.mobile.device-token"
    private static let pendingService = "org.feedbacks.mobile.pending-pairing"

    public static func save(_ credential: FeedbacksCredential, for serverURL: URL) throws {
        try saveItem(credential, service: service, for: serverURL)
    }

    public static func load(for serverURL: URL) throws -> FeedbacksCredential? {
        try loadItem(FeedbacksCredential.self, service: service, for: serverURL)
    }

    public static func clear(for serverURL: URL) throws {
        try clearItem(service: service, for: serverURL)
    }

    /// Persist this secret before opening the approval browser, so pairing can resume after app termination.
    public static func savePending(_ pairing: FeedbacksPairing, for serverURL: URL) throws {
        try saveItem(pairing, service: pendingService, for: serverURL)
    }

    public static func loadPending(for serverURL: URL) throws -> FeedbacksPairing? {
        try loadItem(FeedbacksPairing.self, service: pendingService, for: serverURL)
    }

    public static func clearPending(for serverURL: URL) throws {
        try clearItem(service: pendingService, for: serverURL)
    }

    private static func query(service: String, serverURL: URL) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: serverURL.absoluteString
        ]
    }

    private static func saveItem<T: Encodable>(_ value: T, service: String, for serverURL: URL) throws {
        let data = try JSONEncoder().encode(value)
        let lookup = query(service: service, serverURL: serverURL)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let updated = SecItemUpdate(lookup as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw FeedbacksKeychainError(status: updated) }
        var item = lookup
        for (key, value) in attributes { item[key] = value }
        let added = SecItemAdd(item as CFDictionary, nil)
        if added == errSecDuplicateItem {
            let retry = SecItemUpdate(lookup as CFDictionary, attributes as CFDictionary)
            guard retry == errSecSuccess else { throw FeedbacksKeychainError(status: retry) }
        } else if added != errSecSuccess {
            throw FeedbacksKeychainError(status: added)
        }
    }

    private static func loadItem<T: Decodable>(_ type: T.Type, service: String, for serverURL: URL) throws -> T? {
        var lookup = query(service: service, serverURL: serverURL)
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw FeedbacksKeychainError(status: status)
        }
        return try JSONDecoder().decode(type, from: data)
    }

    private static func clearItem(service: String, for serverURL: URL) throws {
        let status = SecItemDelete(query(service: service, serverURL: serverURL) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw FeedbacksKeychainError(status: status)
        }
    }
}

public struct FeedbacksKeychainError: Error {
    public let status: OSStatus
}
