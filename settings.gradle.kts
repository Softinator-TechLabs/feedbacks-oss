pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "feedbacks-android-smoke"
include(":feedbacks-android", ":feedbacks-android-host")
project(":feedbacks-android").projectDir = file("sdk/android")
project(":feedbacks-android-host").projectDir = file("sdk/android-host")
