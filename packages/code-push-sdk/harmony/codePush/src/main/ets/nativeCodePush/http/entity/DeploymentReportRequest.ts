/**
 * reportStatus/deploy request body
 */
export interface DeploymentReportRequest {
  appVersion: string
  clientUniqueId?: string
  deploymentKey: string
  previousDeploymentKey?: string
  previousLabelOrAppVersion?: string
  label?: string
  status?: string
  patchFailed?: boolean
}