// All fields are non-nullable, except when retrieving the currently running package on the first run of the app,
// in which case only the appVersion is compulsory
export class Package {
  deploymentKey: string
  description: string
  label: string
  appVersion: string
  isDisabled: boolean
  isMandatory: boolean
  packageHash: string
  packageSize: number
  originalLabel: string
  patchFailed?: boolean
  rollout?: number
}
