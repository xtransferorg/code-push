package com.microsoft.codepush.react

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import android.text.TextUtils
import java.util.UUID

object DeviceUtils {

    private const val KEY_UDID: String = "KEY_UDID"

    private var cache: SharedPreferences? = null

    @Volatile
    private var udid: String = ""

    fun getUniqueDeviceId(context: Context, useCache: Boolean = true): String {
        if (!useCache) {
            return getUniqueDeviceIdReal(context)
        }
        if (udid.isBlank()) {
            synchronized(DeviceUtils::class.java) {
                if (udid.isBlank()) {
                    if (cache == null) {
                        cache = context.getSharedPreferences("XRNUtils", Context.MODE_PRIVATE)
                    }
                    val id = cache?.getString(KEY_UDID, null)
                    if (id != null) {
                        udid = id
                        return udid
                    }

                    return getUniqueDeviceIdReal(context)
                }
            }
        }
        return udid
    }

    private fun getUniqueDeviceIdReal(context: Context): String {
        try {
            val androidId = getAndroidID(context)
            if (!TextUtils.isEmpty(androidId)) {
                return saveUdid(androidId)
            }
        } catch (ignore: Exception) { /**/
        }
        return saveUdid(UUID.randomUUID().toString())
    }

    @SuppressLint("HardwareIds")
    private fun getAndroidID(context: Context): String {
        val id =
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        if ("9774d56d682e549c" == id) return ""
        return id ?: ""
    }

    private fun saveUdid(id: String): String {
        udid = id
        cache?.edit()?.putString(KEY_UDID, id)?.apply()
        return udid
    }

}