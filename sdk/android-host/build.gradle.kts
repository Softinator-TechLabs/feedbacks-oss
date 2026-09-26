plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.feedbacks.mobile.smoke"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.feedbacks.mobile.smoke"
        minSdk = 26
        targetSdk = 35
    }
}

dependencies {
    implementation(project(":feedbacks-android"))
}
