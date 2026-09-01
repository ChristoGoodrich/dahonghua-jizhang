import java.util.Properties

// Release signing, if a key exists.
//
// `key.properties` is gitignored and never committed — it holds the path to a
// keystore and two passwords. Absent, the release build falls back to the
// debug key below and says so, which keeps `flutter build apk --release`
// working for anyone who just cloned this. What it will not do is fall back
// silently: an APK signed with the debug key cannot be updated by a properly
// signed one later, so a build that quietly did it would be a trap.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKey = keystorePropertiesFile.exists()
if (hasReleaseKey) {
    keystoreProperties.load(keystorePropertiesFile.inputStream())
}

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.dahonghua.flutter_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications schedules against java.time, which does
        // not exist below API 26. Desugaring backports it rather than raising
        // minSdk and dropping every phone older than Android 8.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // The identity the shipping app already has. Not the namespace above,
        // which is the Kotlin package and stays where the source lives: this
        // is what Android installs the app AS, and it is the same app the
        // React Native build was — a rewrite of the inside, not a new product.
        //
        // Consequence worth knowing: installing over the existing app needs
        // the same signing key it was published with. Without it, Android
        // refuses the update and it is uninstall-then-install, which means the
        // old ledger leaves with it. The JSON backup export is the way across.
        applicationId = "com.dahonghua.app"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = keystoreProperties["storeFile"]?.let { file(it) }
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                // The warning has to travel with the APK, not with the
                // terminal it was built in: `flutter build` swallows Gradle's
                // logger below -v, and a scrollback line is gone by the time
                // this matters anyway. A suffixed versionName shows up in
                // Android's own app info, so the build says what it is
                // wherever it ends up.
                versionNameSuffix = "-debugsigned"
                logger.warn(
                    """
                    
                      android/key.properties not found - signing this release with the DEBUG key.
                      Fine for testing on your own phone. Not installable as an update over a
                      properly signed build, and not publishable. See android/README.md.
                    """.trimIndent()
                )
                signingConfigs.getByName("debug")
            }

            // The Rust core is the app's logic; what is left in Dart is UI, and
            // shrinking it removes the plugin classes reflection cannot see.
            // Off until there is a release build to test it against — a
            // stripped APK that crashes on one screen is worse than a large one.
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}

flutter {
    source = "../.."
}
