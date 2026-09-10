package xrn.modules.codepush

enum class SyncStatus {

    /**
     * The app is up-to-date with the CodePush server.
     */
    UP_TO_DATE,

    /**
     * The app had an optional update which the end user chose to ignore.
     * (This is only applicable when the updateDialog is used)
     */
    UPDATE_IGNORED,

    /**
     * There is an ongoing sync operation running which prevents the current call from being executed.
     */
    SYNC_IN_PROGRESS,

    /**
     * The CodePush server is being queried for an update.
     */
    CHECKING_FOR_UPDATE,

    /**
     * The update check is complete.
     */
    CHECKING_DONE,

    /**
     * An update is available, and a confirmation dialog was shown
     * to the end user. (This is only applicable when the updateDialog is used)
     */
    AWAITING_USER_ACTION,

    /**
     * An available update is being downloaded from the CodePush server.
     */
    DOWNLOADING_PACKAGE,

    /**
    * The update downloaded.
    */
    PACKAGE_DOWNLOADED,

    /**
     * An available update was downloaded and is about to be installed.
     */
    INSTALLING_UPDATE,

    /**
     * An available update has been installed and will be run either immediately after the
     * syncStatusChangedCallback function returns or the next time the app resumes/restarts,
     * depending on the InstallMode specified in SyncOptions
     */
    UPDATE_INSTALLED,

    /**
     * The update in patch mode is being applied.
     */
    PATCH_START,

    /**
     * The update in patch mode is complete.
     */
    PATCH_DONE,

    /**
     * The update in patch mode has failed.
     */
    PATCH_ERROR,

    /**
     * The sync operation encountered an unknown error.
     */
    UNKNOWN_ERROR,
}