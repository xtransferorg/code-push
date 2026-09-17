package xrn.modules.codepush

interface HandleBinaryVersionMismatchCallback {

    fun call(update: RemotePackage?)

}