import Foundation
import Security

/// This-device-only storage for a paired token, keyed by the exact Feedbacks server URL.
public enum FeedbacksKeychain {
    private static let service = "org.feedbacks.mobile.device-token"

    public static func save(_ credential: FeedbacksCredential, for serverURL: URL) throws {
        let data = try JSONEncoder().encode(credential)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: serverURL.absoluteString
        ]
        let prior = SecItemDelete(query as CFDictionary)
        guard prior == errSecSuccess || prior == errSecItemNotFound else {
            throw FeedbacksKeychainError(status: prior)
        }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw FeedbacksKeychainError(status: status) }
    }

    public static func load(for serverURL: URL) throws -> FeedbacksCredential? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: serverURL.absoluteString
        ]
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw FeedbacksKeychainError(status: status)
        }
        return try JSONDecoder().decode(FeedbacksCredential.self, from: data)
    }

    public static func clear(for serverURL: URL) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: serverURL.absoluteString
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw FeedbacksKeychainError(status: status)
        }
    }
}

public struct FeedbacksKeychainError: Error {
    public let status: OSStatus
}
