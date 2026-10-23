package com.nabocorp.companion

import android.app.Activity
import android.app.Application
import android.os.Bundle

/** App-lock grace belongs to the application, including camera/activity transfers. */
internal class AppVisibility(private val lock: AppLock) : Application.ActivityLifecycleCallbacks {
    private val started = mutableSetOf<Activity>()
    override fun onActivityStarted(activity: Activity) { if (started.add(activity) && started.size == 1) lock.didReturn() }
    override fun onActivityStopped(activity: Activity) {
        if (started.remove(activity) && started.isEmpty() && !activity.isChangingConfigurations && !lock.isAuthenticating) lock.didLeave()
    }
    override fun onActivityDestroyed(activity: Activity) { if (started.contains(activity)) onActivityStopped(activity) }
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
}
