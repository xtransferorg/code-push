import { NativeAppVersionStatus } from '@xrnjs/code-push-core'

export class PublishStateMachine {
  private currentState: NativeAppVersionStatus
  private rolloutPercentage: number

  constructor(state: NativeAppVersionStatus, rolloutPercentage: number) {
    this.currentState = state
    this.rolloutPercentage = rolloutPercentage
  }

  public getCurrentState(): NativeAppVersionStatus {
    return this.currentState
  }

  public transitionTo(state: NativeAppVersionStatus, rollout: number): boolean {
    if (state === this.currentState) {
      return true
    }
    switch (this.currentState) {
      case NativeAppVersionStatus.ReadyForReview:
        // ReadyForReview 可流转到 PendingReview / MarketApproved / Discarded
        if (
          state === NativeAppVersionStatus.PendingReview ||
          state === NativeAppVersionStatus.MarketApproved ||
          state === NativeAppVersionStatus.Discarded
        ) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.PendingReview:
        // 审核拒绝后重新提审通过
        if (state === NativeAppVersionStatus.MarketApproved) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.MarketApproved:
        // 开始灰度放量 / 审核前废弃
        if (
          state === NativeAppVersionStatus.Rollout ||
          state === NativeAppVersionStatus.Discarded
        ) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.Rollout:
        // 灰度完成 → Published（需 rollout >= 100），或主动暂停 → Paused
        if (
          state === NativeAppVersionStatus.Published &&
          (this.rolloutPercentage >= 100 || rollout >= 100)
        ) {
          this.currentState = state
          return true
        } else if (state === NativeAppVersionStatus.Paused) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.Paused:
        // 恢复灰度 / 末次追平 -> Published / 自动流转 -> RolloutClosed
        if (
          state === NativeAppVersionStatus.Rollout ||
          state === NativeAppVersionStatus.RolloutClosed
        ) {
          this.currentState = state
          return true
        }
        break
      case NativeAppVersionStatus.Published:
      case NativeAppVersionStatus.RolloutClosed:
      case NativeAppVersionStatus.Discarded:
        // 终态，不允许流转
        break
    }
    return false
  }
}
