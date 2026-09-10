package xrn.modules.codepush

interface SyncStatusChangedCallback {

    fun call(status: SyncStatus, remotePackage: RemotePackage?, localPackage: LocalPackage? = null, e: Throwable? = null)

}
