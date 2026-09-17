package com.microsoft.codepush.react

data class CodePushConfiguration(
    val serverUrl: String,
    val appVersion: String,
    val clientUniqueId: String,
    val deploymentKey: String,
    val packageHash: String? = null,
    val commonHash: String? = null,
)