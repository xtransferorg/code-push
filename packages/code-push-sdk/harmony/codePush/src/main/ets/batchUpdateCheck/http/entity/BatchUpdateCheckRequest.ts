export type BatchUpdateCheckRequest = {
  appVersion: string;
  clientUniqueId: string;
  items: BatchUpdateCheckItems[];
}

export type BatchUpdateCheckItems = {
  basePackageHash: string
  commonHash: string
  deploymentKey: string
  label: string
  packageHash: string
}