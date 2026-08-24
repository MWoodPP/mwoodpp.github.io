pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal() // put it back
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "WoodSBXBraintree3"
include(":app")
