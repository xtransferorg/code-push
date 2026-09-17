package xrn.modules.codepush

import com.microsoft.codepush.react.CodePushInstallMode


data class SyncOptions(
    val deploymentKey: String? = null,
    /**
     * Specifies when you would like to install optional updates (i.e. those that aren't marked as mandatory).
     * Defaults to codePush.InstallMode.ON_NEXT_RESTART.
     */
    val installMode: CodePushInstallMode = CodePushInstallMode.ON_NEXT_RESTART,
    /**
     * Specifies when you would like to install updates which are marked as mandatory.
     * Defaults to codePush.InstallMode.IMMEDIATE.
     */
    val mandatoryInstallMode: CodePushInstallMode = CodePushInstallMode.IMMEDIATE,
    /**
     * Specifies the minimum number of seconds that the app needs to have been in the background before restarting the app. This property
     * only applies to updates which are installed using `InstallMode.ON_NEXT_RESUME`, and can be useful for getting your update in front
     * of end users sooner, without being too obtrusive. Defaults to `0`, which has the effect of applying the update immediately after a
     * resume, regardless how long it was in the background.
     */
    val minimumBackgroundDuration: Int = 0,
    /**
     * The rollback retry mechanism allows the application to attempt to reinstall an update that was previously rolled back (with the restrictions
     * specified in the options). It is an "options" object used to determine whether a rollback retry should occur, and if so, what settings to use
     * for the rollback retry. This defaults to null, which has the effect of disabling the retry mechanism. Setting this to any truthy value will enable
     * the retry mechanism with the default settings, and passing an object to this parameter allows enabling the rollback retry as well as overriding
     * one or more of the default values.
     */
    val rollbackRetryOptions: RollbackRetryOptions? = null,
    val ignoreFailedUpdates: Boolean = true,
    val updateDialog: Boolean = false
) {
    data class RollbackRetryOptions(
        /**
         * Specifies the minimum time in hours that the app will wait after the latest rollback
         * before attempting to reinstall same rolled-back package. Defaults to `24`.
         */
        val delayInHours: Int = 24,

        /**
         * Specifies the maximum number of retry attempts that the app can make before it stops trying.
         * Cannot be less than `1`. Defaults to `1`.
         */
        val maxRetryAttempts: Int = 1,
    ) {
        fun isValid(): Boolean {
            return maxRetryAttempts >= 1
        }
    }
}

