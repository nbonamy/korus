plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val product = groovy.json.JsonSlurper().parse(file("../../../core/src/product.json")) as Map<*, *>

android {
    namespace = "com.nabocorp.companion"
    compileSdk = 36
    defaultConfig {
        applicationId = product["appId"] as String
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    val signingVariables = listOf("APP_ANDROID_KEYSTORE", "APP_ANDROID_KEY_ALIAS", "APP_ANDROID_KEYSTORE_PASSWORD", "APP_ANDROID_KEY_PASSWORD")
    val signingValues = signingVariables.map { providers.environmentVariable(it).orNull }
    val signingRequested = providers.gradleProperty("companionSignedRelease").orNull == "true"
    require(!signingRequested && signingValues.all { it.isNullOrEmpty() } || signingValues.all { !it.isNullOrEmpty() }) {
        "Release signing requires ${signingVariables.joinToString(", ")}."
    }
    if (signingValues.all { !it.isNullOrEmpty() }) {
        signingConfigs.create("operatorRelease") {
            storeFile = file(signingValues[0]!!)
            keyAlias = signingValues[1]
            storePassword = signingValues[2]
            keyPassword = signingValues[3]
        }
    }
    buildTypes {
        create("verification") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".verification"
            matchingFallbacks.add("debug")
        }
        release {
            signingConfig = signingConfigs.findByName("operatorRelease")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    testBuildType = "verification"
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    constraints {
        implementation("androidx.fragment:fragment:1.8.9") {
            because("Play Services requests Fragment 1.1, which predates Activity Result permissions support.")
        }
    }
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.compose.ui:ui:1.8.2")
    implementation("androidx.compose.ui:ui-tooling-preview:1.8.2")
    implementation("androidx.compose.material3:material3:1.4.0")
    implementation("androidx.compose.material:material-icons-extended:1.7.8")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.camera:camera-camera2:1.6.2")
    implementation("androidx.camera:camera-lifecycle:1.6.2")
    implementation("androidx.camera:camera-view:1.6.2")
    implementation("com.google.zxing:core:3.5.4")
    implementation("com.google.firebase:firebase-messaging:25.1.3")
    debugImplementation("androidx.compose.ui:ui-tooling:1.8.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.8.2")
    "verificationImplementation"("androidx.compose.ui:ui-test-manifest:1.8.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4:1.8.2")
}
