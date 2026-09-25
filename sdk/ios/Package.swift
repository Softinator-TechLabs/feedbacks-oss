// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FeedbacksMobile",
    platforms: [.iOS(.v15), .macOS(.v13)],
    products: [.library(name: "FeedbacksMobile", targets: ["FeedbacksMobile"])],
    targets: [
        .target(name: "FeedbacksMobile"),
        .executableTarget(name: "FeedbacksMobileSmoke", dependencies: ["FeedbacksMobile"], path: "Tests/Smoke"),
        .testTarget(name: "FeedbacksMobileTests", dependencies: ["FeedbacksMobile"])
    ]
)
