#if canImport(UIKit)
import UIKit

/// Captures only the view supplied by the host app after an explicit user action.
/// The caller must preview and redact the bytes before upload.
@MainActor public enum FeedbacksScreenshot {
    public static func capture(view: UIView) -> Data? {
        guard view.bounds.width > 0, view.bounds.height > 0 else { return nil }
        let renderer = UIGraphicsImageRenderer(bounds: view.bounds)
        let image = renderer.image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        return image.pngData()
    }
}
#endif
